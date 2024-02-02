import { AbstractControl, ValidatorFn } from '@angular/forms';

// Validator function that allows only full numbers
export function fullNumberValidator(): ValidatorFn {
  return (control: AbstractControl): {[key: string]: any} | null => {
    // Check if the control value is not null or empty before testing
    if (control.value !== null && control.value !== '') {
      // Test if the value is an integer
      const isFullNumber = Number.isInteger(Number(control.value));
      // Return null if valid (is an integer), or an object if invalid
      return isFullNumber ? null : { 'notFullNumber': { value: control.value } };
    }
    return null; // Consider null or empty string as valid
  };
}
