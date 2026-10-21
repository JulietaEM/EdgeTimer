import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import api from '../../api';
import { FormModal } from '../../components/FormModal';
import { LabeledInput } from '../../components/LabeledInput';
import { colors, fonts } from '../../theme';
import type { BloqueDisponibilidad, CitaBarbero } from '../../types';
import { readError } from '../../utils/errors';
import { formatShortDate } from '../../utils/format';

/** Pide un motivo opcional antes de rechazar o cancelar una cita. */
export function MotivoModal({
  action,
  cita,
  onClose,
  onDone,
}: {
  action: 'rechazar' | 'cancelar';
  cita: CitaBarbero | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMotivo('');
    setError('');
  }, [cita]);

  const submit = async () => {
    if (!cita) return;
    setSaving(true);
    setError('');
    try {
      const response = await api.patch(`/barbero/citas/${cita.id}/${action}`, { motivo });
      onDone(response.data.message);
    } catch (err) {
      setError(readError(err, 'No fue posible completar la acción.'));
    } finally {
      setSaving(false);
    }
  };

  const isReject = action === 'rechazar';

  return (
    <FormModal
      danger
      loading={saving}
      open={cita !== null}
      submitLabel={isReject ? 'Rechazar solicitud' : 'Cancelar cita'}
      title={isReject ? 'Rechazar solicitud' : 'Cancelar cita'}
      onClose={onClose}
      onSubmit={submit}
    >
      <Text style={styles.text}>
        {cita
          ? `${cita.cliente.nombre} · ${formatShortDate(cita.fecha)} · ${cita.horaInicio}`
          : ''}
      </Text>
      <LabeledInput
        label="Motivo (opcional)"
        hint="El cliente podrá ver este mensaje."
        value={motivo}
        onChangeText={setMotivo}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function toHour(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Día de la semana ISO (1 = lunes) de una fecha AAAA-MM-DD, o null si no es válida. */
function isoWeekday(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00-05:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return ((parsed.getUTCDay() + 6) % 7) + 1;
}

/** Reprograma una cita: elige fecha y una hora de inicio dentro de la disponibilidad. */
export function ReprogramModal({
  bloques,
  cita,
  onClose,
  onDone,
}: {
  bloques: BloqueDisponibilidad[];
  cita: CitaBarbero | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFecha(cita?.fecha ?? '');
    setHora(cita?.horaInicio ?? '');
    setError('');
  }, [cita]);

  // Horas de inicio posibles ese día: la cita completa debe caber en un tramo.
  const options = useMemo(() => {
    const day = isoWeekday(fecha);
    if (!day || !cita) return [];

    const duration = cita.duracionTotal;
    const starts: string[] = [];
    for (const block of bloques.filter((item) => item.dia === day)) {
      for (let t = toMinutes(block.inicio); t + duration <= toMinutes(block.fin); t += 15) {
        starts.push(toHour(t));
      }
    }
    return starts;
  }, [bloques, cita, fecha]);

  const submit = async () => {
    if (!cita) return;
    if (!hora) {
      setError('Elige una hora de inicio.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await api.patch(`/barbero/citas/${cita.id}/reprogramar`, {
        fecha,
        horaInicio: hora,
      });
      onDone(response.data.message);
    } catch (err) {
      setError(readError(err, 'No fue posible reprogramar la cita.'));
    } finally {
      setSaving(false);
    }
  };

  const tooSoon = cita ? new Date(cita.inicioAt).getTime() - Date.now() < DAY_MS : false;

  return (
    <FormModal
      loading={saving}
      open={cita !== null}
      submitLabel="Reprogramar"
      title="Reprogramar cita"
      onClose={onClose}
      onSubmit={submit}
    >
      {cita ? (
        <Text style={styles.text}>
          {cita.cliente.nombre} · {cita.duracionTotal} min · ahora: {formatShortDate(cita.fecha)}{' '}
          {cita.horaInicio}
        </Text>
      ) : null}
      {tooSoon ? (
        <Text style={styles.error}>
          Solo puedes reprogramar citas con al menos 1 día de antelación.
        </Text>
      ) : null}
      <LabeledInput
        label="Nueva fecha"
        placeholder="AAAA-MM-DD"
        value={fecha}
        onChangeText={(value) => {
          setFecha(value);
          setHora('');
        }}
      />
      <View>
        <Text style={styles.label}>Hora de inicio</Text>
        {options.length === 0 ? (
          <Text style={styles.text}>
            {isoWeekday(fecha)
              ? 'No tienes disponibilidad ese día para una cita de esta duración.'
              : 'Escribe una fecha válida (AAAA-MM-DD).'}
          </Text>
        ) : (
          <View style={styles.pillWrap}>
            {options.map((option) => (
              <Pressable
                key={option}
                style={[styles.pill, hora === option && styles.pillSelected]}
                onPress={() => setHora(option)}
              >
                <Text style={[styles.pillText, hora === option && styles.pillTextSelected]}>
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
  label: { color: colors.black, fontFamily: fonts.medium, fontSize: 19, marginBottom: 7 },
  error: { color: colors.danger, fontFamily: fonts.medium, fontSize: 18 },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pillSelected: { backgroundColor: colors.black, borderColor: colors.black },
  pillText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 17 },
  pillTextSelected: { color: colors.white },
});
