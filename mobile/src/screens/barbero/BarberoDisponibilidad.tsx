import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import api from '../../api';
import { colors, fonts } from '../../theme';
import type { BloqueDisponibilidad } from '../../types';
import { readError } from '../../utils/errors';
import { normalizeTimeInput } from '../../utils/format';

const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

type Row = { inicio: string; fin: string };
type Week = Record<number, Row[]>;

const emptyWeek = (): Week => ({ 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] });

// Disponibilidad semanal del barbero (RF-12). Los clientes solo ven y agendan
// dentro de estos horarios; el barbero ya no "abre" citas una por una.
export function BarberoDisponibilidadScreen() {
  const [week, setWeek] = useState<Week>(emptyWeek());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 4000);
  };

  useEffect(() => {
    api
      .get('/barbero/disponibilidad')
      .then((response) => {
        const next = emptyWeek();
        for (const block of response.data.bloques as BloqueDisponibilidad[]) {
          next[block.dia].push({ inicio: block.inicio, fin: block.fin });
        }
        setWeek(next);
      })
      .catch((err) => setError(readError(err, 'No fue posible cargar tu disponibilidad.')))
      .finally(() => setLoading(false));
  }, []);

  const update = (day: number, rows: Row[]) => setWeek((current) => ({ ...current, [day]: rows }));

  const addRow = (day: number) => {
    const rows = week[day];
    const last = rows[rows.length - 1];
    update(day, [...rows, last ? { inicio: last.fin, fin: '' } : { inicio: '09:00', fin: '17:00' }]);
  };

  const changeRow = (day: number, index: number, field: keyof Row, value: string) =>
    update(
      day,
      week[day].map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );

  const removeRow = (day: number, index: number) =>
    update(
      day,
      week[day].filter((_, i) => i !== index),
    );

  const copyMonday = () =>
    setWeek((current) => ({
      ...current,
      2: current[1].map((row) => ({ ...row })),
      3: current[1].map((row) => ({ ...row })),
      4: current[1].map((row) => ({ ...row })),
      5: current[1].map((row) => ({ ...row })),
    }));

  const save = async () => {
    const bloques: BloqueDisponibilidad[] = [];
    for (const day of [1, 2, 3, 4, 5, 6, 7]) {
      for (const row of week[day]) {
        bloques.push({ dia: day, inicio: normalizeTimeInput(row.inicio), fin: normalizeTimeInput(row.fin) });
      }
    }

    setSaving(true);
    setError('');
    try {
      const response = await api.put('/barbero/disponibilidad', { bloques });
      // El servidor une los tramos pegados o solapados: se muestra como quedó.
      const next = emptyWeek();
      for (const block of response.data.bloques as BloqueDisponibilidad[]) {
        next[block.dia].push({ inicio: block.inicio, fin: block.fin });
      }
      setWeek(next);
      showToast(response.data.message);
    } catch (err) {
      setError(readError(err, 'No fue posible guardar tu disponibilidad.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.kicker}>Disponibilidad</Text>
        <Text style={styles.title}>Tu horario semanal</Text>
      </View>
      <Text style={styles.intro}>
        Define los días y las horas en que atiendes. Los clientes solo podrán pedirte citas dentro
        de estos horarios; tú decides si aceptas cada solicitud. Usa el formato 24 horas (por
        ejemplo 09:00 a 13:00); puedes agregar varias franjas en un día para dejar un descanso.
      </Text>

      <Pressable style={styles.copyButton} onPress={copyMonday}>
        <Text style={styles.copyButtonText}>Copiar el lunes a martes–viernes</Text>
      </Pressable>

      {loading ? <Text style={styles.intro}>Cargando...</Text> : null}

      <View style={styles.days}>
        {DAYS.map((name, index) => {
          const day = index + 1;
          const rows = week[day];
          return (
            <View key={day} style={styles.dayCard}>
              <Text style={styles.dayTitle}>{name}</Text>
              {rows.length === 0 ? <Text style={styles.off}>No atiendes</Text> : null}
              {rows.map((row, i) => (
                <View key={i} style={styles.row}>
                  <TextInput
                    style={styles.input}
                    value={row.inicio}
                    placeholder="09:00"
                    placeholderTextColor={colors.muted}
                    keyboardType="numbers-and-punctuation"
                    onChangeText={(value) => changeRow(day, i, 'inicio', value)}
                    onBlur={() => changeRow(day, i, 'inicio', normalizeTimeInput(row.inicio))}
                  />
                  <Text style={styles.to}>a</Text>
                  <TextInput
                    style={styles.input}
                    value={row.fin}
                    placeholder="17:00"
                    placeholderTextColor={colors.muted}
                    keyboardType="numbers-and-punctuation"
                    onChangeText={(value) => changeRow(day, i, 'fin', value)}
                    onBlur={() => changeRow(day, i, 'fin', normalizeTimeInput(row.fin))}
                  />
                  <Pressable onPress={() => removeRow(day, i)}>
                    <Text style={styles.remove}>Quitar</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable onPress={() => addRow(day)}>
                <Text style={styles.add}>+ Agregar franja</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={[styles.save, saving && styles.disabled]} disabled={saving} onPress={save}>
        <Text style={styles.saveText}>{saving ? 'Guardando...' : 'Guardar disponibilidad'}</Text>
      </Pressable>

      {toast ? <Text style={styles.toast}>{toast}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: 10 },
  kicker: { color: colors.darkGold, fontFamily: fonts.medium, fontSize: 21 },
  title: { color: colors.black, fontFamily: fonts.title, fontSize: 36 },
  intro: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 18,
    marginBottom: 14,
    maxWidth: 680,
  },
  copyButton: {
    alignSelf: 'flex-start',
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  copyButtonText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 16 },
  days: { gap: 12, maxWidth: 560 },
  dayCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  dayTitle: { color: colors.black, fontFamily: fonts.title, fontSize: 21 },
  off: { color: colors.muted, fontFamily: fonts.medium, fontSize: 17 },
  row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  input: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.black,
    fontFamily: fonts.medium,
    fontSize: 19,
    minHeight: 44,
    paddingHorizontal: 12,
    textAlign: 'center',
    width: 90,
  },
  to: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
  remove: { color: colors.danger, fontFamily: fonts.title, fontSize: 16 },
  add: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 17 },
  error: {
    color: colors.danger,
    fontFamily: fonts.medium,
    fontSize: 18,
    marginTop: 14,
    maxWidth: 560,
  },
  save: {
    alignSelf: 'flex-start',
    backgroundColor: colors.gold,
    borderRadius: 8,
    marginBottom: 30,
    marginTop: 18,
    paddingHorizontal: 20,
    paddingVertical: 13,
  },
  saveText: { color: colors.white, fontFamily: fonts.title, fontSize: 18 },
  disabled: { opacity: 0.6 },
  toast: {
    alignSelf: 'center',
    backgroundColor: colors.black,
    borderRadius: 8,
    bottom: 16,
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 18,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingVertical: 10,
    position: 'absolute',
  },
});
