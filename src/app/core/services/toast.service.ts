import { Injectable } from '@angular/core';
import { ToastrService, ToastPackage, ToastRef, Toast } from 'ngx-toastr';

@Injectable({ providedIn: 'root' })
export class ToastService {
  constructor(private toastr: ToastrService) {}

  success(message: string, title?: string, timeOut: number = 3000) {
    this.toastr.success(message, title, { timeOut: timeOut });
  }

  error(message: string, title?: string, timeOut: number = 3000) {
    this.toastr.error(message, title, { timeOut: timeOut });
  }

  info(message: string, title?: string, timeOut: number = 3000) {
    this.toastr.info(message, title, { timeOut: timeOut });
  }

  warning(message: string, title?: string, timeOut: number = 3000) {
    this.toastr.warning(message, title, { timeOut: timeOut });
  }
}
