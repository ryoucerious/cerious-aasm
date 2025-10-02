import { ApiService } from './api.service';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { throwError } from 'rxjs';

describe('ApiService', () => {
  let service: ApiService;
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService]
    });
    service = TestBed.inject(ApiService);
  });
  it('should be created', () => {
    expect(service).toBeTruthy();
  });
  it('should call http.post with correct arguments and return observable', () => {
    const http = jasmine.createSpyObj('HttpClient', ['post']);
    const api = new ApiService(http);
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    http.post.and.returnValue(obs);
    const result = api.post('url', { foo: 'bar' });
    expect(http.post).toHaveBeenCalledWith('url', { foo: 'bar' });
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should call http.get with correct arguments and return observable', () => {
    const http = jasmine.createSpyObj('HttpClient', ['get']);
    const api = new ApiService(http);
    const obs = { subscribe: jasmine.createSpy('subscribe') } as any;
    http.get.and.returnValue(obs);
    const result = api.get('url');
    expect(http.get).toHaveBeenCalledWith('url');
    expect(result).toBe(obs);
    result.subscribe();
    expect(obs.subscribe).toHaveBeenCalled();
  });

  it('should propagate errors from http.post', (done) => {
    const http = jasmine.createSpyObj('HttpClient', ['post']);
    const api = new ApiService(http);
    http.post.and.returnValue(throwError(() => 'fail'));
    api.post('url', {}).subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });

  it('should propagate errors from http.get', (done) => {
    const http = jasmine.createSpyObj('HttpClient', ['get']);
    const api = new ApiService(http);
    http.get.and.returnValue(throwError(() => 'fail'));
    api.get('url').subscribe({
      error: (err: any) => {
        expect(err).toBe('fail');
        done();
      }
    });
  });
});
