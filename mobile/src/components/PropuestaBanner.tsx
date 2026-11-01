import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';
import type { PropuestaCita } from '../types';
import { formatShortDate } from '../utils/format';

/**
 * Aviso de cambio de horario dentro de una tarjeta de cita. La cita sigue en su
 * horario original hasta que la otra parte acepte; según quién mira, se muestran
 * Aceptar / Rechazar (la propuso la otra parte) o Retirar (la propuso quien mira).
 */
export function PropuestaBanner({
  propuesta,
  otraParte,
  busy,
  onAccept,
  onReject,
  onWithdraw,
}: {
  propuesta: PropuestaCita;
  /** Nombre de la otra persona de la cita. */
  otraParte: string;
  busy?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
  onWithdraw?: () => void;
}) {
  const nuevo = `${formatShortDate(propuesta.fecha)} · ${propuesta.horaInicio} - ${propuesta.horaFin}`;

  return (
    <View style={styles.box}>
      {propuesta.puedeResponder ? (
        <>
          <Text style={styles.title}>{otraParte} propone cambiar el horario</Text>
          <Text style={styles.text}>Nuevo horario: {nuevo}</Text>
          <Text style={styles.hint}>La cita sigue en su horario actual hasta que aceptes.</Text>
          <View style={styles.actions}>
            {onAccept ? (
              <Pressable
                disabled={busy}
                style={[styles.primary, busy && styles.disabled]}
                onPress={onAccept}
              >
                <Text style={styles.primaryText}>Aceptar cambio</Text>
              </Pressable>
            ) : null}
            {onReject ? (
              <Pressable
                disabled={busy}
                style={[styles.ghost, busy && styles.disabled]}
                onPress={onReject}
              >
                <Text style={styles.ghostText}>Rechazar</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : (
        <>
          <Text style={styles.title}>Esperando respuesta de {otraParte}</Text>
          <Text style={styles.text}>Propusiste: {nuevo}</Text>
          <Text style={styles.hint}>Mientras tanto, la cita sigue en su horario actual.</Text>
          {onWithdraw ? (
            <View style={styles.actions}>
              <Pressable
                disabled={busy}
                style={[styles.ghost, busy && styles.disabled]}
                onPress={onWithdraw}
              >
                <Text style={styles.ghostText}>Retirar propuesta</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.softGold,
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    marginTop: 10,
    padding: 12,
  },
  title: { color: colors.black, fontFamily: fonts.title, fontSize: 18 },
  text: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
  hint: { color: colors.muted, fontFamily: fonts.medium, fontSize: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  primary: {
    backgroundColor: colors.black,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  primaryText: { color: colors.white, fontFamily: fonts.title, fontSize: 16 },
  ghost: {
    backgroundColor: colors.white,
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  ghostText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 16 },
  disabled: { opacity: 0.45 },
});
