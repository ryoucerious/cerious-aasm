import { generateRandomPassword } from './crypto.utils';

describe('Crypto Utils', () => {
  describe('generateRandomPassword', () => {
    it('should generate a password of the specified length', () => {
      const length = 16;
      const password = generateRandomPassword(length);
      expect(password.length).toBe(length);
    });

    it('should generate different passwords on multiple calls', () => {
      const password1 = generateRandomPassword(10);
      const password2 = generateRandomPassword(10);
      expect(password1).not.toBe(password2);
    });

    it('should only contain alphanumeric characters', () => {
      const password = generateRandomPassword(20);
      const alphanumericRegex = /^[A-Za-z0-9]+$/;
      expect(alphanumericRegex.test(password)).toBe(true);
    });

    it('should handle length of 1', () => {
      const password = generateRandomPassword(1);
      expect(password.length).toBe(1);
      expect(typeof password).toBe('string');
    });

    it('should handle length of 0', () => {
      const password = generateRandomPassword(0);
      expect(password.length).toBe(0);
      expect(password).toBe('');
    });
  });
});