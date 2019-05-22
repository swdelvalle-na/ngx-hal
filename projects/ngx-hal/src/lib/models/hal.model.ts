import { Observable } from 'rxjs';
import { ModelOptions, DEFAULT_MODEL_OPTIONS } from '../interfaces/model-options.interface';
import { RawHalResource } from '../interfaces/raw-hal-resource.interface';
import {
  ATTRIBUTE_PROPERTIES_METADATA_KEY,
  HAL_MODEL_DOCUMENT_CLASS_METADATA_KEY,
  HAS_ONE_PROPERTIES_METADATA_KEY,
  HAS_MANY_PROPERTIES_METADATA_KEY
} from '../constants/metadata.constant';
import { HalDocumentConstructor } from '../types/hal-document-construtor.type';
import { ModelProperty, AttributeModelProperty, HasOneModelProperty, HasManyModelProperty } from '../interfaces/model-property.interface';
import { LINKS_PROPERTY_NAME, SELF_PROPERTY_NAME, EMBEDDED_PROPERTY_NAME } from '../constants/hal.constant';
import { DatastoreService } from '../services/datastore/datastore.service';
import { RawHalLink } from '../interfaces/raw-hal-link.interface';
import { RawHalLinks } from '../interfaces/raw-hal-links.interface';
import { HalDocument } from '../classes/hal-document';
import { NetworkConfig } from '../interfaces/network-config.interface';
import { generateUUID } from '../helpers/uuid/uuid.helper';

export abstract class HalModel {
  private config: ModelOptions = this.config || DEFAULT_MODEL_OPTIONS;
  private temporarySelfLink: string = null;
  private localModelIdentificator: string;

  constructor(
    private resource: RawHalResource = {},
    private datastore: DatastoreService
  ) {
    this.setLocalModelIdentificator();
    this.parseAttributes(resource);
    this.createHasOneGetters();
    this.createHasManyGetters();
  }

  public get uniqueModelIdentificator(): string {
    if (!this.links[SELF_PROPERTY_NAME]) {
      return this.localModelIdentificator;
    }

    return this.links[SELF_PROPERTY_NAME].href;
  }

  public get id(): string {
    if (!this.selfLink) {
      return null;
    }

    return this.selfLink.split('/').pop();
  }

  public get endpoint(): string {
    return this.config.endpoint || this.constructor.name;
  }

  public get networkConfig(): NetworkConfig {
    return this.config.networkConfig;
  }

  public getHalDocumentClass<T extends this>(): HalDocumentConstructor<T> {
    return Reflect.getMetadata(HAL_MODEL_DOCUMENT_CLASS_METADATA_KEY, this.constructor);
  }

  public getRelationshipUrl(relationshipName: string): string {
    return this.links[relationshipName] ? this.links[relationshipName].href : '';
  }

  public getPropertyData(propertyName: string): ModelProperty {
    const attributeProperty = this.attributeProperties.find((property: ModelProperty) => property.name === propertyName);
    const hasOneProperty = this.hasOneProperties.find((property: ModelProperty) => property.name === propertyName);
    const hasManyProperty = this.hasManyProperties.find((property: ModelProperty) => property.name === propertyName);
    return attributeProperty || hasOneProperty || hasManyProperty;
  }

  public getEmbeddedResource(resourceName: string): RawHalResource | undefined {
    if (this.resource[resourceName]) {
      return this.resource[resourceName];
    }

    if (!this.resource[EMBEDDED_PROPERTY_NAME]) {
      return;
    }

    return this.resource[EMBEDDED_PROPERTY_NAME][resourceName];
  }

  public save(): Observable<this> {
    return this.datastore.save(this, Object.getPrototypeOf(this));
  }

  public generatePayload(): object {
    const attributePropertiesPayload: object = this.attributeProperties.reduce((payload: object, property: AttributeModelProperty) => {
      const propertyName: string = property.name;
      payload[propertyName] = property.transformBeforeSave ? property.transformBeforeSave(this[propertyName]) : this[propertyName];
      return payload;
    }, {});

    const hasOnePropertiesPayload: object = this.hasOneProperties
      .filter((property: HasOneModelProperty) => property.includeInPayload)
      .reduce((payload: object, property: HasOneModelProperty) => {
        const propertyName: string = property.name;

        if (!this[propertyName]) {
          return payload;
        }

        payload[propertyName] = {
          href: this[propertyName].selfLink
        };

        return payload;
      }, {});

    const hasManyPropertiesPayload: object = this.hasManyProperties
      .filter((property: HasManyModelProperty) => property.includeInPayload)
      .reduce((payload: object, property: HasManyModelProperty) => {
        const propertyName: string = property.name;
        payload[propertyName] = [];

        if (!this[propertyName]) {
          return payload;
        }

        // TODO check if this[propertyName] is an array of models or just a HalDocument
        this[propertyName].forEach((model: HalModel) => {
          if (!model) {
            return payload;
          }

          payload[propertyName].push({
            href: model.selfLink
          });
        });

        return payload;
      }, {});

    const relationshipLinks: object = { ...hasOnePropertiesPayload, ...hasManyPropertiesPayload };
    const hasRelationshipLinks: boolean = Boolean(Object.keys(relationshipLinks).length);

    const payload = { ...attributePropertiesPayload };

    if (hasRelationshipLinks) {
      payload[LINKS_PROPERTY_NAME] = { ...hasOnePropertiesPayload, ...hasManyPropertiesPayload };
    }

    return payload;
  }

  public get isSaved(): boolean {
    return Boolean(this.id);
  }

  private get attributeProperties(): Array<ModelProperty> {
    return Reflect.getMetadata(ATTRIBUTE_PROPERTIES_METADATA_KEY, this) || [];
  }

  private get hasOneProperties(): Array<ModelProperty> {
    return Reflect.getMetadata(HAS_ONE_PROPERTIES_METADATA_KEY, this) || [];
  }

  private get hasManyProperties(): Array<ModelProperty> {
    return Reflect.getMetadata(HAS_MANY_PROPERTIES_METADATA_KEY, this) || [];
  }

  private createHasOneGetters(): void {
    this.hasOneProperties.forEach((property: ModelProperty) => {
      Object.defineProperty(HalModel.prototype, property.name, {
        get() {
          const relationshipLinks: RawHalLink = this.links[property.name];

          if (!relationshipLinks) {
            return;
          }

          const modelIdentificator: string = relationshipLinks.href;
          return this.datastore.storage.get(modelIdentificator);
        },
        set<T extends HalModel>(value: T) {
          this.replaceRelationshipModel(property.name, value);
        }
      });
    });
  }

  private createHasManyGetters(): void {
    this.hasManyProperties.forEach((property: ModelProperty) => {
      Object.defineProperty(HalModel.prototype, property.name, {
        get() {
          const relationshipLink: RawHalLink = this.links[property.name];

          if (!relationshipLink) {
            return;
          }

          const modelIdentificator: string = relationshipLink.href;
          const halDocument: HalDocument<HalModel> = this.datastore.storage.get(modelIdentificator) as HalDocument<HalModel>;

          if (!halDocument) {
            console.warn(`Has many relationship ${property.name} is not fetched.`);
            return;
          }

          return halDocument.models;
        },
        set<T extends HalModel>(value: Array<T>) {
          const halDocumentRaw = { models: value, uniqueModelIdentificator: `local-document-identificator-${generateUUID()}` };
          this.datastore.storage.save(halDocumentRaw);
          this.replaceRelationshipModel(property.name, halDocumentRaw);
        }
      });
    });
  }

  private parseAttributes(resource: RawHalResource): void {
    this.attributeProperties.forEach((attributeProperty: AttributeModelProperty) => {
      const rawPropertyValue: any = resource[attributeProperty.name];

      if (attributeProperty.propertyClass) {
        this[attributeProperty.name] = new attributeProperty.propertyClass(rawPropertyValue);
      } else if (attributeProperty.tranformResponseValue) {
        this[attributeProperty.name] = attributeProperty.tranformResponseValue(rawPropertyValue);
      } else {
        this[attributeProperty.name] = rawPropertyValue;
      }
    });
  }

  private get links(): RawHalLinks | {} {
    return this.resource[LINKS_PROPERTY_NAME] || {};
  }

  public get selfLink(): string {
    return this.links && this.links[SELF_PROPERTY_NAME] ? this.links[SELF_PROPERTY_NAME].href : this.temporarySelfLink;
  }

  public set selfLink(link: string) {
    this.temporarySelfLink = link;
  }

  private replaceRelationshipModel<T extends HalModel>(relationshipName: string, relationshipModel: T): void {
    this.resource[LINKS_PROPERTY_NAME] = this.resource[LINKS_PROPERTY_NAME] || { self: null };

    this.resource[LINKS_PROPERTY_NAME][relationshipName] = {
      href: relationshipModel.selfLink || relationshipModel.uniqueModelIdentificator
    };
  }

  private setLocalModelIdentificator(): void {
    this.localModelIdentificator = `local-model-identificator-${generateUUID()}`;
  }
}
