import { BadRequestException } from '@nestjs/common';
import {
  diffIds,
  isUuid,
  normalizeIds,
  parseDuration,
  parsePage,
  parsePrice,
} from './admin.utils';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('admin.utils', () => {
  describe('normalizeIds', () => {
    it('devuelve undefined si no se envió la lista', () => {
      expect(normalizeIds(undefined)).toBeUndefined();
      expect(normalizeIds(null)).toBeUndefined();
    });

    it('acepta uuids, quita repetidos y pasa a minúsculas', () => {
      expect(normalizeIds([A, A.toUpperCase(), B])).toEqual([A, B]);
    });

    it('acepta una lista vacía (quitar todas)', () => {
      expect(normalizeIds([])).toEqual([]);
    });

    it.each([['no-es-lista'], [[1]], [['no-uuid']], [Array(51).fill(A)]])(
      'rechaza %p',
      (value) => {
        expect(() => normalizeIds(value)).toThrow(BadRequestException);
      },
    );
  });

  describe('diffIds', () => {
    it('calcula qué agregar y qué quitar', () => {
      expect(diffIds([A], [A, B])).toEqual({ toAdd: [B], toRemove: [] });
      expect(diffIds([A, B], [B])).toEqual({ toAdd: [], toRemove: [A] });
      expect(diffIds([A], [B])).toEqual({ toAdd: [B], toRemove: [A] });
      expect(diffIds([A, B], [A, B])).toEqual({ toAdd: [], toRemove: [] });
    });
  });

  describe('parsePrice', () => {
    it('acepta enteros y texto numérico', () => {
      expect(parsePrice(35000)).toBe(35000);
      expect(parsePrice('35000')).toBe(35000);
      expect(parsePrice(0)).toBe(0);
    });

    it.each([[-1], [35000.5], ['abc'], [''], [null], [10_000_001]])(
      'rechaza %p',
      (value) => {
        expect(() => parsePrice(value)).toThrow(BadRequestException);
      },
    );
  });

  describe('parseDuration', () => {
    it('acepta múltiplos de 15 entre 15 y 480', () => {
      expect(parseDuration(15)).toBe(15);
      expect(parseDuration('60')).toBe(60);
      expect(parseDuration(480)).toBe(480);
    });

    it.each([[0], [10], [20], [495], [45.5], ['abc'], [undefined]])(
      'rechaza %p',
      (value) => {
        expect(() => parseDuration(value)).toThrow(BadRequestException);
      },
    );
  });

  describe('parsePage', () => {
    it('usa valores por defecto', () => {
      expect(parsePage(undefined, undefined)).toEqual({ offset: 0, limit: 20 });
    });

    it('acota el offset y el límite', () => {
      expect(parsePage('-5', '500')).toEqual({ offset: 0, limit: 50 });
      expect(parsePage('40', '0')).toEqual({ offset: 40, limit: 1 });
    });

    it('rechaza valores que no son enteros', () => {
      expect(() => parsePage('x', undefined)).toThrow(BadRequestException);
    });
  });

  describe('isUuid', () => {
    it('reconoce uuids', () => {
      expect(isUuid(A)).toBe(true);
      expect(isUuid('123')).toBe(false);
      expect(isUuid(undefined)).toBe(false);
    });
  });
});
