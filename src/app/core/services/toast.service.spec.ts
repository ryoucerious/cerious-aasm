import { ToastService } from './toast.service';
import { ToastrService } from 'ngx-toastr';

describe('ToastService', () => {
  let service: ToastService;
  let toastrSpy: jasmine.SpyObj<ToastrService>;

  beforeEach(() => {
    toastrSpy = jasmine.createSpyObj('ToastrService', ['success', 'error', 'info', 'warning']);
    service = new ToastService(toastrSpy);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should call toastr.success', () => {
    service.success('msg', 'title', 1234);
    expect(toastrSpy.success).toHaveBeenCalledWith('msg', 'title', { timeOut: 1234 });
  });

  it('should call toastr.error', () => {
    service.error('msg', 'title', 2345);
    expect(toastrSpy.error).toHaveBeenCalledWith('msg', 'title', { timeOut: 2345 });
  });

  it('should call toastr.info', () => {
    service.info('msg', 'title', 3456);
    expect(toastrSpy.info).toHaveBeenCalledWith('msg', 'title', { timeOut: 3456 });
  });

  it('should call toastr.warning', () => {
    service.warning('msg', 'title', 4567);
    expect(toastrSpy.warning).toHaveBeenCalledWith('msg', 'title', { timeOut: 4567 });
  });
});
