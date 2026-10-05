import * as crypto from 'crypto';
import { generateRandomPassword } from './crypto.utils';

describe('generateRandomPassword', () => {
  it('generates a password of the requested length', () => {
    expect(generateRandomPassword(16)).toHaveLength(16);
    expect(generateRandomPassword(1)).toHaveLength(1);
    expect(generateRandomPassword(0)).toBe('');
  });

  it('uses only letters and digits', () => {
    expect(generateRandomPassword(64)).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('draws every character from the crypto RNG, not Math.random', () => {
    const randomInt = jest.mocked(crypto.randomInt) as unknown as jest.Mock;
    randomInt.mockReturnValueOnce(0).mockReturnValueOnce(61).mockReturnValueOnce(26);
    const mathRandom = jest.spyOn(Math, 'random');

    expect(generateRandomPassword(3)).toBe('A9a');
    expect(randomInt).toHaveBeenCalledWith(62);
    expect(mathRandom).not.toHaveBeenCalled();
  });

  it('generates different passwords on each call', () => {
    expect(generateRandomPassword(16)).not.toBe(generateRandomPassword(16));
  });
});
