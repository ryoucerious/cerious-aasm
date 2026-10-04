import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FieldDefinition, FieldDefinitionsService } from './field-definitions.service';

describe('FieldDefinitionsService', () => {
  let service: FieldDefinitionsService;
  let httpMock: HttpTestingController;
  const mockFields: FieldDefinition[] = [
    { tab: 'general', label: 'Session Name', key: 'sessionName', type: 'text', default: 'ARK Server' },
    { tab: 'rates', label: 'XP Multiplier', key: 'xpMultiplier', type: 'number', default: 1.0 }
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(FieldDefinitionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads the definitions', () => {
    let fields: FieldDefinition[] | undefined;
    service.getFieldDefinitions().subscribe(result => fields = result);

    const req = httpMock.expectOne('assets/advanced-settings-meta.json');
    expect(req.request.method).toBe('GET');
    req.flush(mockFields);

    expect(fields).toEqual(mockFields);
  });

  it('fetches the file once however many callers ask', () => {
    const received: FieldDefinition[][] = [];
    service.getFieldDefinitions().subscribe(fields => received.push(fields));
    service.getFieldDefinitions().subscribe(fields => received.push(fields));

    httpMock.expectOne('assets/advanced-settings-meta.json').flush(mockFields);
    service.getFieldDefinitions().subscribe(fields => received.push(fields));

    expect(received.length).toBe(3);
  });

  it('retries after a failed fetch', () => {
    service.getFieldDefinitions().subscribe({ error: () => {} });
    httpMock.expectOne('assets/advanced-settings-meta.json').flush('gone', { status: 404, statusText: 'Not Found' });

    let fields: FieldDefinition[] | undefined;
    service.getFieldDefinitions().subscribe(result => fields = result);
    httpMock.expectOne('assets/advanced-settings-meta.json').flush(mockFields);

    expect(fields).toEqual(mockFields);
  });
});
