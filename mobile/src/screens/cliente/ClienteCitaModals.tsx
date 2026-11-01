import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import api from '../../api';
import { FormModal } from '../../components/FormModal';
import { LabeledInput } from '../../components/LabeledInput';
import { colors, fonts } from '../../theme';
import type { CitaCliente, DisponibilidadCliente } from '../../types';
import { readError } from '../../utils/errors';
import { formatShortDate } from '../../utils/format';

/** Pide un motivo opcional antes de cancelar. */
export function CancelarModal({
  cita,
  onClose,
  onDone,
}: {
  cita: CitaCliente | null;
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
      const response = await api.patch(`/cliente/citas/${cita.id}/cancelar`, { motivo });
      onDone(response.data.message);
    } catch (err) {
      setError(readError(err, 'No fue posible cancelar la cita.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      danger
      loading={saving}
      open={cita !== null}
      submitLabel="Cancelar cita"
      title="Cancelar cita"
      onClose={onClose}
      onSubmit={submit}
    >
      <Text style={styles.text}>
        {cita
          ? `${cita.barbero.nombre} · ${formatShortDate(cita.fecha)} · ${cita.horaInicio}`
          : ''}
      </Text>
      <LabeledInput
        label="Motivo (opcional)"
        hint="El barbero podrá ver este mensaje."
        maxLength={200}
        value={motivo}
        onChangeText={setMotivo}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

/**
 * Reprograma una cita: solo muestra las horas realmente libres del barbero para
 * la duración de esta cita. Si estaba confirmada, el barbero deberá confirmarla de nuevo.
 */
export function ReprogramarModal({
  cita,
  onClose,
  onDone,
}: {
  cita: CitaCliente | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [disponibilidad, setDisponibilidad] = useState<DisponibilidadCliente | null>(null);
  const [fecha, setFecha] = useState<string | null>(null);
  const [hora, setHora] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFecha(null);
    setHora(null);
    setError('');
    setDisponibilidad(null);
    if (!cita) return;

    let active = true;
    setLoading(true);

    api
      .get<DisponibilidadCliente>(`/cliente/barberos/${cita.barbero.id}/disponibilidad`, {
        params: { excluirCita: cita.id },
      })
      .then((response) => active && setDisponibilidad(response.data))
      .catch((err) => active && setError(readError(err, 'No fue posible cargar las horas disponibles.')))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [cita]);

  // La hora actual de la cita no es una opción: no tendría sentido "mover" a la misma hora.
  const horasDe = (dia: string, horas: string[]) =>
    cita && dia === cita.fecha ? horas.filter((item) => item !== cita.horaInicio) : horas;

  const dias = (disponibilidad?.dias ?? []).filter((dia) => horasDe(dia.fecha, dia.horas).length > 0);
  const horas = fecha ? horasDe(fecha, dias.find((dia) => dia.fecha === fecha)?.horas ?? []) : [];

  const submit = async () => {
    if (!cita) return;
    if (!fecha || !hora) {
      setError('Elige una fecha y una hora.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const response = await api.patch(`/cliente/citas/${cita.id}/reprogramar`, {
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

  return (
    <FormModal
      loading={saving}
      open={cita !== null}
      submitLabel={cita?.estado === 'confirmada' ? 'Enviar propuesta' : 'Reprogramar'}
      title={cita?.estado === 'confirmada' ? 'Proponer otro horario' : 'Reprogramar cita'}
      onClose={onClose}
      onSubmit={submit}
    >
      <Text style={styles.text}>
        {cita
          ? `Ahora: ${formatShortDate(cita.fecha)} · ${cita.horaInicio} (${cita.duracionMinutos} min)`
          : ''}
      </Text>
      {cita?.estado === 'confirmada' ? (
        <Text style={styles.notice}>
          Esta cita ya está confirmada: tu cita no cambia hasta que el barbero acepte el nuevo
          horario. Mientras tanto sigue en su horario actual.
        </Text>
      ) : null}

      {loading ? (
        <Text style={styles.text}>Buscando horas disponibles...</Text>
      ) : disponibilidad && dias.length === 0 ? (
        <Text style={styles.text}>No hay otras horas disponibles en los próximos días.</Text>
      ) : disponibilidad ? (
        <View>
          <Text style={styles.label}>Día</Text>
          <View style={styles.pillWrap}>
            {dias.map((dia) => (
              <Pressable
                key={dia.fecha}
                style={[styles.pill, fecha === dia.fecha && styles.pillSelected]}
                onPress={() => {
                  setFecha(dia.fecha);
                  setHora(null);
                }}
              >
                <Text style={[styles.pillText, fecha === dia.fecha && styles.pillTextSelected]}>
                  {formatShortDate(dia.fecha)}
                </Text>
              </Pressable>
            ))}
          </View>

          {fecha ? (
            <View>
              <Text style={styles.label}>Hora</Text>
              <View style={styles.pillWrap}>
                {horas.map((item) => (
                  <Pressable
                    key={item}
                    style={[styles.pill, hora === item && styles.pillSelected]}
                    onPress={() => setHora(item)}
                  >
                    <Text style={[styles.pillText, hora === item && styles.pillTextSelected]}>
                      {item}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </FormModal>
  );
}

const styles = StyleSheet.create({
  text: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18, marginBottom: 10 },
  notice: {
    backgroundColor: colors.softGold,
    borderRadius: 8,
    color: colors.darkGold,
    fontFamily: fonts.medium,
    fontSize: 17,
    marginBottom: 12,
    overflow: 'hidden',
    padding: 10,
  },
  label: {
    color: colors.black,
    fontFamily: fonts.medium,
    fontSize: 19,
    marginBottom: 8,
    marginTop: 8,
  },
  error: { color: colors.danger, fontFamily: fonts.medium, fontSize: 18, marginTop: 8 },
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
