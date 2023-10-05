import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, retry } from 'rxjs/operators';

@Injectable()
export class HttpRetryInterceptor implements HttpInterceptor {

  /**
   * HACK: Adds a retry functionality to all http calls, because we are really stressing the API
   */
  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(req).pipe(

      catchError((error: HttpErrorResponse) => {
        if (error.status === 404) {
          // If response is a 404, do not retry and throw the error immediately
          return throwError(() => error);
        }

        // Otherwise, retry the request up to 3 times
        return throwError(() => error).pipe(
          retry({
            count: 3,
            delay: 1000
          } )
        );
      })
    );
  }
}
