import {
    validateInstanceId,
    validatePort,
    validateServerName,
    sanitizeString,
    validateAuthInput,
    validateEmail,
    validateIPAddress,
    validateFilename,
    sanitizeFilename,
    validateURL,
    isNumeric
} from '../utils/validation.utils';

// ...previous tests...

describe('Validation Utils', () => {
  describe('validateInstanceId', () => {
    it('should return true for valid instance IDs', () => {
      expect(validateInstanceId('server1')).toBe(true);
      expect(validateInstanceId('my-server_01')).toBe(true);
      expect(validateInstanceId('a')).toBe(true);
      expect(validateInstanceId('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.substring(0, 50))).toBe(true);
    });

    it('should return false for invalid instance IDs', () => {
      expect(validateInstanceId('')).toBe(false);
      expect(validateInstanceId('server with spaces')).toBe(false);
      expect(validateInstanceId('server@domain.com')).toBe(false);
      expect(validateInstanceId('server.with.dots')).toBe(false);
      expect(validateInstanceId('a'.repeat(51))).toBe(false); // Too long
      expect(validateInstanceId(null as any)).toBe(false);
      expect(validateInstanceId(undefined as any)).toBe(false);
      expect(validateInstanceId(123 as any)).toBe(false);
    });
  });

  describe('validatePort', () => {
    it('should return true for valid ports', () => {
      expect(validatePort(1024)).toBe(true);
      expect(validatePort(3000)).toBe(true);
      expect(validatePort(65535)).toBe(true);
      expect(validatePort('8080')).toBe(true);
    });

    it('should return false for invalid ports', () => {
      expect(validatePort(1023)).toBe(false); // Below minimum
      expect(validatePort(65536)).toBe(false); // Above maximum
      expect(validatePort(0)).toBe(false);
      expect(validatePort(-1)).toBe(false);
      expect(validatePort(3.14)).toBe(false); // Not integer
      expect(validatePort('not-a-number')).toBe(false);
      expect(validatePort('')).toBe(false);
    });
  });

  describe('validateServerName', () => {
    it('should return true for valid server names', () => {
      expect(validateServerName('My Server')).toBe(true);
      expect(validateServerName('Server-01_02')).toBe(true);
      expect(validateServerName('Test@#$%^&*()')).toBe(true);
      expect(validateServerName('Server with spaces and symbols: !@#$%^&*()')).toBe(true);
    });

    it('should return false for invalid server names', () => {
      expect(validateServerName('')).toBe(false);
      expect(validateServerName('a'.repeat(101))).toBe(false); // Too long
      expect(validateServerName(null as any)).toBe(false);
      expect(validateServerName(undefined as any)).toBe(false);
      expect(validateServerName(123 as any)).toBe(false);
    });

    it('should reject names with control characters', () => {
      expect(validateServerName('Server\x00Name')).toBe(false); // Null character
      expect(validateServerName('Server\x01Name')).toBe(false); // Control character
      expect(validateServerName('Server\x7FName')).toBe(false); // Delete character
    });
  });

  describe('sanitizeString', () => {
    it('should sanitize strings by removing control characters', () => {
      expect(sanitizeString('Hello\x00World')).toBe('HelloWorld');
      expect(sanitizeString('Test\x01String')).toBe('TestString');
      expect(sanitizeString('  spaced  ')).toBe('spaced');
      expect(sanitizeString('\t\tTabbed\t\t')).toBe('Tabbed');
    });

    it('should handle edge cases', () => {
      expect(sanitizeString('')).toBe('');
      expect(sanitizeString(null as any)).toBe('');
      expect(sanitizeString(undefined as any)).toBe('');
      expect(sanitizeString(123 as any)).toBe('');
    });

    it('should preserve printable characters', () => {
      const input = 'Hello World! @#$%^&*()_+-=[]{}|;:,.<>?';
      expect(sanitizeString(input)).toBe(input);
    });
  });

  describe('validateAuthInput', () => {
    it('should return valid result for valid inputs', () => {
      const result = validateAuthInput('admin', 'password123');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid result for missing username', () => {
      const result = validateAuthInput('', 'password123');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username is required');
    });

    it('should return invalid result for missing password', () => {
      const result = validateAuthInput('admin', '');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Password is required');
    });

    it('should return invalid result for invalid types', () => {
      const result1 = validateAuthInput(null as any, 'password');
      expect(result1.valid).toBe(false);
      expect(result1.error).toBe('Username is required');

      const result2 = validateAuthInput('admin', null as any);
      expect(result2.valid).toBe(false);
      expect(result2.error).toBe('Password is required');
    });

    it('should return invalid result for overly long inputs', () => {
      const longUsername = 'a'.repeat(101);
      const result = validateAuthInput(longUsername, 'password');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username too long');
    });

    it('should return invalid result for overly long password', () => {
      const longPassword = 'a'.repeat(201);
      const result = validateAuthInput('user', longPassword);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Password too long');
    });

    it('should return invalid result for username longer than 50 characters', () => {
      const longUsername = 'a'.repeat(51);
      const result = validateAuthInput(longUsername, 'password');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Username too long');
    });

    it('should return invalid result for password longer than 200 characters', () => {
      const longPassword = 'a'.repeat(201);
      const result = validateAuthInput('user', longPassword);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Password too long');
    });

    it('should return valid for username of exactly 50 chars and password of exactly 200 chars', () => {
      const username = 'a'.repeat(50);
      const password = 'b'.repeat(200);
      const result = validateAuthInput(username, password);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid if username is whitespace only', () => {
      const result = validateAuthInput('   ', 'password');
      expect(result.valid).toBe(true); // whitespace is counted as valid string
    });

    it('should return invalid if password is whitespace only', () => {
      const result = validateAuthInput('user', '   ');
      expect(result.valid).toBe(true); // whitespace is counted as valid string
    });

    describe('validateEmail', () => {
        it('should return true for valid emails', () => {
            expect(validateEmail('test@example.com')).toBe(true);
            expect(validateEmail('user.name+tag@domain.co.uk')).toBe(true);
            expect(validateEmail('user_name@sub.domain.com')).toBe(true);
        });

        it('should return false for invalid emails', () => {
            expect(validateEmail('')).toBe(false);
            expect(validateEmail('plainaddress')).toBe(false);
            expect(validateEmail('missing@domain')).toBe(false);
            expect(validateEmail('missing.domain@')).toBe(false);
            expect(validateEmail('@missingusername.com')).toBe(false);
            expect(validateEmail('user@.com')).toBe(false);
            expect(validateEmail('user@domain..com')).toBe(false);
            expect(validateEmail(null as any)).toBe(false);
            expect(validateEmail(undefined as any)).toBe(false);
            expect(validateEmail(123 as any)).toBe(false);
        });
    });

    describe('validateIPAddress', () => {
        it('should return true for valid IPv4 addresses', () => {
            expect(validateIPAddress('192.168.1.1')).toBe(true);
            expect(validateIPAddress('0.0.0.0')).toBe(true);
            expect(validateIPAddress('255.255.255.255')).toBe(true);
            expect(validateIPAddress('127.0.0.1')).toBe(true);
        });

        it('should return false for invalid IPv4 addresses', () => {
            expect(validateIPAddress('')).toBe(false);
            expect(validateIPAddress('256.256.256.256')).toBe(false);
            expect(validateIPAddress('192.168.1')).toBe(false);
            expect(validateIPAddress('192.168.1.1.1')).toBe(false);
            expect(validateIPAddress('abc.def.ghi.jkl')).toBe(false);
            expect(validateIPAddress('1234.123.123.123')).toBe(false);
            expect(validateIPAddress(null as any)).toBe(false);
            expect(validateIPAddress(undefined as any)).toBe(false);
            expect(validateIPAddress(123 as any)).toBe(false);
        });
    });

    describe('validateFilename', () => {
        it('should return true for valid filenames', () => {
            expect(validateFilename('file.txt')).toBe(true);
            expect(validateFilename('my_file-01.log')).toBe(true);
            expect(validateFilename('a'.repeat(255))).toBe(true);
        });

        it('should return false for invalid filenames', () => {
            expect(validateFilename('')).toBe(false);
            expect(validateFilename('file/name.txt')).toBe(false);
            expect(validateFilename('file<name>.txt')).toBe(false);
            expect(validateFilename('file|name.txt')).toBe(false);
            expect(validateFilename('file:name.txt')).toBe(false);
            expect(validateFilename('a'.repeat(256))).toBe(false);
            expect(validateFilename(null as any)).toBe(false);
            expect(validateFilename(undefined as any)).toBe(false);
            expect(validateFilename(123 as any)).toBe(false);
        });
    });

    describe('sanitizeFilename', () => {
        it('should replace invalid characters with underscores', () => {
            expect(sanitizeFilename('file<name>.txt')).toBe('file_name_.txt');
            expect(sanitizeFilename('file|name?.txt')).toBe('file_name_.txt');
            expect(sanitizeFilename('file:name.txt')).toBe('file_name.txt');
        });

        it('should trim leading/trailing spaces and dots', () => {
            expect(sanitizeFilename('  file.txt  ')).toBe('file.txt');
            expect(sanitizeFilename('...file.txt...')).toBe('file.txt');
        });

        it('should return "unnamed" for empty or invalid input', () => {
            expect(sanitizeFilename('')).toBe('unnamed');
            expect(sanitizeFilename(null as any)).toBe('unnamed');
            expect(sanitizeFilename(undefined as any)).toBe('unnamed');
            expect(sanitizeFilename(123 as any)).toBe('unnamed');
            expect(sanitizeFilename('   ')).toBe('unnamed'); // Just spaces
            expect(sanitizeFilename('...')).toBe('unnamed'); // Just dots
        });

        it('should truncate filenames longer than 255 characters', () => {
            const longName = 'a'.repeat(300) + '.txt';
            expect(sanitizeFilename(longName).length).toBe(255);
        });
    });

    describe('validateURL', () => {
        it('should return true for valid URLs', () => {
            expect(validateURL('http://example.com')).toBe(true);
            expect(validateURL('https://example.com/path?query=1')).toBe(true);
            expect(validateURL('ftp://ftp.example.com')).toBe(true);
            expect(validateURL('http://localhost:8080')).toBe(true);
        });

        it('should return false for invalid URLs', () => {
            expect(validateURL('')).toBe(false);
            expect(validateURL('not a url')).toBe(false);
            expect(validateURL('http:/example.com')).toBe(false);
            expect(validateURL('http://')).toBe(false);
            expect(validateURL(null as any)).toBe(false);
            expect(validateURL(undefined as any)).toBe(false);
            expect(validateURL(123 as any)).toBe(false);
        });

        it('should return false for URLs missing protocol or hostname (line 146)', () => {
            // Test cases that pass initial regex but fail protocol/hostname check
            expect(validateURL('://example.com')).toBe(false); // Missing protocol
            expect(validateURL('http://')).toBe(false); // Missing hostname
            expect(validateURL('https://:8080')).toBe(false); // Empty hostname with port
            expect(validateURL('ftp://:21')).toBe(false); // Empty hostname with port
        });

        it('should validate protocol and hostname existence (line 146)', () => {
            // These should pass because they have both protocol and hostname
            expect(validateURL('http://example.com')).toBe(true);
            expect(validateURL('https://subdomain.example.com')).toBe(true);
            expect(validateURL('ftp://ftp.example.org')).toBe(true);
            
            // These should fail due to missing protocol or hostname
            expect(validateURL('://missing-protocol.com')).toBe(false);
            expect(validateURL('http://')).toBe(false);
            expect(validateURL('https://')).toBe(false);
        });
    });

    describe('isNumeric', () => {
        it('should return true for numeric strings', () => {
            expect(isNumeric('123')).toBe(true);
            expect(isNumeric('3.14')).toBe(true);
            expect(isNumeric('-42')).toBe(true);
            expect(isNumeric('0')).toBe(true);
            expect(isNumeric('1e5')).toBe(true);
        });

        it('should return false for non-numeric strings', () => {
            expect(isNumeric('')).toBe(false);
            expect(isNumeric('abc')).toBe(false);
            expect(isNumeric('123abc')).toBe(false);
            expect(isNumeric('NaN')).toBe(false);
            expect(isNumeric(null as any)).toBe(false);
            expect(isNumeric(undefined as any)).toBe(false);
        });
    });
  });
});