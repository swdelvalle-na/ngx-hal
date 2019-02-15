import { HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { HalModel } from '../../models/hal.model';
import { DatastoreService } from '../datastore/datastore.service';
import { RawHalResource } from '../../interfaces/raw-hal-resource.interface';
import { EMBEDDED_PROPERTY_NAME, LINKS_PROPERTY_NAME } from '../../constants/hal.constant';
import { isArray } from '../../utils/isArray/is-array.util';
import { RequestOptions } from '../../types/request-options.type';
import { DEFAULT_REQUEST_OPTIONS } from '../../constants/request.constant';
import { HalDocument } from '../../classes/hal-document';

export class ModelService<Model extends HalModel> {
  constructor(private datastore: DatastoreService, private modelClass: {new(...args): Model }) {}

  public findOne(modelId: string, requestOptions: RequestOptions = {}): Observable<Model> {
    const url: string = this.buildModelUrl(modelId);

    const options = Object.assign(DEFAULT_REQUEST_OPTIONS, requestOptions);

    return this.datastore.http.get<Model>(url, options).pipe(
      map((response: HttpResponse<Model>) => {
        return new this.modelClass(this.extractResourceFromResponse(response), response);
      })
    );
  }

  public find(requestOptions: RequestOptions): Observable<Array<Model>>;
  public find(requestOptions: RequestOptions, includeMeta?: boolean): Observable<HalDocument<Model>>;
  public find(requestOptions: RequestOptions, includeMeta?: boolean): Observable<HalDocument<Model>> | Observable<Array<Model>> {
    const url: string = this.buildModelUrl();

    const options = Object.assign(DEFAULT_REQUEST_OPTIONS, requestOptions);

    if (includeMeta) {
      return this.datastore.http.get<Model>(url, options).pipe(
        map((response: HttpResponse<Model>) => {
          const halDocument: HalDocument<Model> = new HalDocument<Model>(response, this.modelClass);
          return halDocument;
        })
      );
    }

    return this.datastore.http.get<Model>(url, options).pipe(
      map((response: HttpResponse<Model>) => {
        const halDocument: HalDocument<Model> = new HalDocument<Model>(response, this.modelClass);
        return halDocument.models;
      })
    );
  }

  private buildModelUrl(modelId?: string): string {
    const modelUrl: string = this.datastore.buildUrl(this.representableModel);
    return modelId ? `${modelUrl}/${modelId}` : modelUrl;
  }

  private get representableModel(): Model {
    return new this.modelClass();
  }

  private extractResourceFromResponse(response: HttpResponse<object>): RawHalResource {
    return response.body;
  }
}
