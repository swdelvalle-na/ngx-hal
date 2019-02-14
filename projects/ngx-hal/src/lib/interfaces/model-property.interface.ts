import { ModelProperty as ModelPropertyEnum } from '../enums/model-property.enum';

export interface ModelProperty {
  type: ModelPropertyEnum;
  propertyClass?: any;
  name: string;
}