import { BadRequestException } from '@nestjs/common';
import { diffIds, normalizeIds } from './admin.utils';

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
});
