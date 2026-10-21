import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../../theme';
import type { CitaBarbero } from '../../types';
import { formatMoney, formatShortDate } from '../../utils/format';

const avatar = require('../../../assets/user.png');

/** Tarjeta de una cita para el barbero. Los botones aparecen según los handlers que se le pasen. */
export function CitaBarberoCard({
  cita,
  compact,
  onAccept,
  onCancel,
  onReject,
  onReprogram,
}: {
  cita: CitaBarbero;
  compact?: boolean;
  onAccept?: () => void;
  onCancel?: () => void;
  onReject?: () => void;
  onReprogram?: () => void;
}) {
  const isOpen = cita.estado === 'pendiente' || cita.estado === 'confirmada';
  const showChange = (onCancel || onReprogram) && isOpen;

  return (
    <View style={[styles.card, compact && styles.fullWidth]}>
      <View style={styles.clientRow}>
        <Image
          source={cita.cliente.foto ? { uri: cita.cliente.foto } : avatar}
          style={styles.avatar}
          resizeMode="cover"
        />
        <View style={styles.clientText}>
          <Text style={styles.title}>{cita.cliente.nombre}</Text>
          {cita.cliente.telefono ? <Text style={styles.text}>{cita.cliente.telefono}</Text> : null}
        </View>
      </View>

      <Text style={styles.text}>
        {cita.procedimientos.map((item) => item.nombre).join(', ') || 'Sin procedimientos'}
      </Text>
      <Text style={styles.text}>
        {formatMoney(cita.costoTotal)} · {cita.duracionTotal} min
      </Text>
      <Text style={styles.when}>
        {formatShortDate(cita.fecha)} · {cita.horaInicio} - {cita.horaFin}
      </Text>
      <Text style={[styles.status, statusStyle(cita)]}>{cita.estadoLabel}</Text>

      {cita.notas ? <Text style={styles.note}>“{cita.notas}”</Text> : null}
      {cita.motivo ? <Text style={styles.note}>Motivo: {cita.motivo}</Text> : null}
      {cita.calificacion ? (
        <Text style={styles.text}>
          Calificación: {cita.calificacion.puntuacion}/5 {cita.calificacion.resena}
        </Text>
      ) : null}

      {onAccept || onReject ? (
        <View style={styles.actions}>
          {onAccept ? (
            <Pressable style={styles.primary} onPress={onAccept}>
              <Text style={styles.primaryText}>Aceptar</Text>
            </Pressable>
          ) : null}
          {onReject ? (
            <Pressable style={styles.ghost} onPress={onReject}>
              <Text style={styles.ghostText}>Rechazar</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {showChange ? (
        <View style={styles.actions}>
          {onReprogram ? (
            <Pressable
              style={[styles.primary, !cita.puedeModificar && styles.disabled]}
              disabled={!cita.puedeModificar}
              onPress={onReprogram}
            >
              <Text style={styles.primaryText}>Reprogramar</Text>
            </Pressable>
          ) : null}
          {onCancel ? (
            <Pressable
              style={[styles.ghost, !cita.puedeModificar && styles.disabled]}
              disabled={!cita.puedeModificar}
              onPress={onCancel}
            >
              <Text style={styles.ghostText}>Cancelar</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {showChange && !cita.puedeModificar ? (
        <Text style={styles.help}>
          Solo puedes cancelar o reprogramar citas con al menos 1 día de antelación.
        </Text>
      ) : null}
    </View>
  );
}

function statusStyle(cita: CitaBarbero) {
  if (cita.estado === 'confirmada' || cita.estado === 'realizada') return styles.statusOk;
  if (cita.estado === 'pendiente' && cita.estadoLabel !== 'Vencida') return undefined;
  return styles.statusOff;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 280,
    flexGrow: 1,
    gap: 4,
    minWidth: 260,
    padding: 16,
  },
  fullWidth: { flexBasis: '100%', minWidth: '100%', width: '100%' },
  clientRow: { alignItems: 'center', flexDirection: 'row', gap: 12, marginBottom: 4 },
  avatar: { backgroundColor: colors.softGold, borderRadius: 24, height: 48, width: 48 },
  clientText: { flex: 1, minWidth: 0 },
  title: { color: colors.black, fontFamily: fonts.title, fontSize: 21 },
  text: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
  when: { color: colors.black, fontFamily: fonts.title, fontSize: 19, marginTop: 2 },
  status: {
    alignSelf: 'flex-start',
    backgroundColor: colors.softGold,
    borderRadius: 8,
    color: colors.darkGold,
    fontFamily: fonts.medium,
    fontSize: 17,
    marginTop: 4,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusOk: { backgroundColor: '#EAF7EE', color: colors.success },
  statusOff: { backgroundColor: '#ECECEC', color: colors.muted },
  note: { color: colors.gray, fontFamily: fonts.medium, fontSize: 17, fontStyle: 'italic' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  primary: {
    backgroundColor: colors.black,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  primaryText: { color: colors.white, fontFamily: fonts.title, fontSize: 16 },
  ghost: {
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  ghostText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 16 },
  disabled: { opacity: 0.45 },
  help: { color: colors.muted, fontFamily: fonts.medium, fontSize: 16, marginTop: 6 },
});
