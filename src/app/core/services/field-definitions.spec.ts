import { FieldDefinitionsService, FieldDefinition } from './field-definitions';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';

describe('FieldDefinitionsService', () => {
  let service: FieldDefinitionsService;
  let httpMock: HttpTestingController;
  const mockFields: FieldDefinition[] = [
    { tab: 'general', label: 'Session Name', key: 'sessionName', type: 'text', default: 'ARK Server' },
    { tab: 'general', label: 'Max Players', key: 'maxPlayers', type: 'number', default: 70 },
    { tab: 'rates', label: 'XP Multiplier', key: 'xpMultiplier', type: 'number', default: 1.0 }
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [FieldDefinitionsService]
    });
    service = TestBed.inject(FieldDefinitionsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should get all field definitions', (done) => {
    service.getFieldDefinitions().subscribe(fields => {
      expect(fields.length).toBe(3);
      expect(fields[0].key).toBe('sessionName');
      done();
    });
    const req = httpMock.expectOne('assets/advanced-settings-meta.json');
    expect(req.request.method).toBe('GET');
    req.flush(mockFields);
  });

  it('should get field label by key', (done) => {
    service.getFieldLabel('maxPlayers').subscribe(label => {
      expect(label).toBe('Max Players');
      done();
    });
    const req = httpMock.expectOne('assets/advanced-settings-meta.json');
    req.flush(mockFields);
  });

  it('should fallback to key if label not found', (done) => {
    service.getFieldLabel('unknownKey').subscribe(label => {
      expect(label).toBe('unknownKey');
      done();
    });
    const req = httpMock.expectOne('assets/advanced-settings-meta.json');
    req.flush(mockFields);
  });

  it('should get field definition by key', (done) => {
    service.getFieldDefinition('xpMultiplier').subscribe(field => {
      expect(field).toBeTruthy();
      expect(field?.label).toBe('XP Multiplier');
      done();
    });
    const req = httpMock.expectOne('assets/advanced-settings-meta.json');
    req.flush(mockFields);
  });

  it('should return undefined for missing field definition', (done) => {
    service.getFieldDefinition('notFound').subscribe(field => {
      expect(field).toBeUndefined();
      done();
    });
    const req = httpMock.expectOne('assets/advanced-settings-meta.json');
    req.flush(mockFields);
  });

  it('should get fields by tab', (done) => {
    service.getFieldsByTab('general').subscribe(fields => {
      expect(fields.length).toBe(2);
      expect(fields[0].key).toBe('sessionName');
      expect(fields[1].key).toBe('maxPlayers');
      done();
    });
    const req = httpMock.expectOne('assets/advanced-settings-meta.json');
    req.flush(mockFields);
  });
});
