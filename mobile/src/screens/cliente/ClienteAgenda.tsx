import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import api from '../../api';
import { PropuestaBanner } from '../../components/PropuestaBanner';
import { colors, fonts } from '../../theme';
import type { CitaCliente } from '../../types';
import { readError } from '../../utils/errors';
import { formatMoney, formatShortDate } from '../../utils/format';
import { CancelarModal, ReprogramarModal } from './ClienteCitaModals';

const avatar = require('../../../assets/user.png');

// Agenda del cliente: sus próximas citas con las acciones de cancelar y reprogramar
// (HU-21). El historial y la calificación llegan con HU-23 y HU-24.
export function ClienteAgendaScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 620;
  const [citas, setCitas] = useState<CitaCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [cancelando, setCancelando] = useState<CitaCliente | null>(null);
  const [reprogramando, setReprogramando] = useState<CitaCliente | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await api.get<CitaCliente[]>('/cliente/citas', {
        params: { grupo: 'proximas' },
      });
      setCitas(response.data);
    } catch (err) {
      setError(readError(err, 'No fue posible cargar tus citas.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const done = (message: string) => {
    setCancelando(null);
    setReprogramando(null);
    setToast(message);
    setTimeout(() => setToast(''), 3500);
    load();
  };

  const respond = async (cita: CitaCliente, action: 'aceptar' | 'rechazar' | 'retirar') => {
    setBusyId(cita.id);
    try {
      const response = await api.patch(`/cliente/citas/${cita.id}/propuesta/${action}`);
      setToast(response.data.message);
    } catch (err) {
      setToast(readError(err, 'No fue posible responder a la propuesta.'));
    } finally {
      setBusyId(null);
      setTimeout(() => setToast(''), 3500);
      load();
    }
  };

  return (
    <View>
      <Text style={styles.kicker}>Agenda cliente</Text>
      <Text style={styles.title}>Mis próximas citas</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <Text style={styles.empty}>Cargando tus citas...</Text>
      ) : citas.length === 0 && !error ? (
        <Text style={styles.empty}>
          No tienes citas próximas. Agenda una desde el Home eligiendo a tu barbero.
        </Text>
      ) : (
        <View style={styles.list}>
          {citas.map((cita) => (
            <CitaCard
              key={cita.id}
              cita={cita}
              compact={isCompact}
              busy={busyId === cita.id}
              onAcceptProposal={() => respond(cita, 'aceptar')}
              onRejectProposal={() => respond(cita, 'rechazar')}
              onWithdrawProposal={() => respond(cita, 'retirar')}
              onCancel={() => setCancelando(cita)}
              onReprogram={() => setReprogramando(cita)}
            />
          ))}
        </View>
      )}

      <CancelarModal cita={cancelando} onClose={() => setCancelando(null)} onDone={done} />
      <ReprogramarModal cita={reprogramando} onClose={() => setReprogramando(null)} onDone={done} />

      {toast ? <Text style={styles.toast}>{toast}</Text> : null}
    </View>
  );
}

function CitaCard({
  cita,
  compact,
  busy,
  onAcceptProposal,
  onCancel,
  onRejectProposal,
  onReprogram,
  onWithdrawProposal,
}: {
  cita: CitaCliente;
  compact: boolean;
  busy: boolean;
  onAcceptProposal: () => void;
  onCancel: () => void;
  onRejectProposal: () => void;
  onReprogram: () => void;
  onWithdrawProposal: () => void;
}) {
  return (
    <View style={[styles.card, compact && styles.fullWidth]}>
      <View style={styles.barberRow}>
        <Image
          source={cita.barbero.foto ? { uri: cita.barbero.foto } : avatar}
          style={styles.avatar}
          resizeMode="cover"
        />
        <View style={styles.barberText}>
          <Text style={styles.cardTitle}>{cita.barbero.nombre}</Text>
          <Text style={styles.cardText}>{cita.barberia.nombre}</Text>
        </View>
      </View>

      <Text style={styles.cardText}>{cita.procedimientos.map((item) => item.nombre).join(', ')}</Text>
      <Text style={styles.cardText}>
        {formatMoney(cita.costoTotal)} · {cita.duracionMinutos} min
      </Text>
      <Text style={styles.when}>
        {formatShortDate(cita.fecha)} · {cita.horaInicio} - {cita.horaFin}
      </Text>
      <Text style={styles.status}>{cita.estadoLabel}</Text>
      {cita.propuesta ? (
        <PropuestaBanner
          busy={busy}
          otraParte={cita.barbero.nombre}
          propuesta={cita.propuesta}
          onAccept={onAcceptProposal}
          onReject={onRejectProposal}
          onWithdraw={onWithdrawProposal}
        />
      ) : null}
      {cita.notas ? <Text style={styles.note}>“{cita.notas}”</Text> : null}

      <View style={styles.actions}>
        <Pressable
          disabled={!cita.puedeModificar || !!cita.propuesta?.puedeResponder}
          style={[
            styles.primary,
            (!cita.puedeModificar || !!cita.propuesta?.puedeResponder) && styles.disabled,
          ]}
          onPress={onReprogram}
        >
          <Text style={styles.primaryText}>Reprogramar</Text>
        </Pressable>
        <Pressable
          disabled={!cita.puedeModificar}
          style={[styles.ghost, !cita.puedeModificar && styles.disabled]}
          onPress={onCancel}
        >
          <Text style={styles.ghostText}>Cancelar</Text>
        </Pressable>
      </View>
      {!cita.puedeModificar ? (
        <Text style={styles.help}>
          Solo puedes cancelar o reprogramar citas con al menos 1 día de antelación.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { color: colors.darkGold, fontFamily: fonts.medium, fontSize: 21 },
  title: { color: colors.black, fontFamily: fonts.title, fontSize: 36, marginBottom: 16 },
  empty: { color: colors.gray, fontFamily: fonts.medium, fontSize: 20, marginBottom: 20 },
  error: { color: colors.danger, fontFamily: fonts.medium, fontSize: 18, marginBottom: 12 },
  list: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 300,
    flexGrow: 1,
    gap: 6,
    maxWidth: 520,
    minWidth: 260,
    padding: 16,
  },
  fullWidth: { maxWidth: '100%', minWidth: '100%', width: '100%' },
  barberRow: { alignItems: 'center', flexDirection: 'row', gap: 12, marginBottom: 4 },
  avatar: { backgroundColor: colors.softGold, borderRadius: 24, height: 48, width: 48 },
  barberText: { flex: 1, minWidth: 0 },
  cardTitle: { color: colors.black, fontFamily: fonts.title, fontSize: 21 },
  cardText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
  when: { color: colors.black, fontFamily: fonts.title, fontSize: 20, marginTop: 4 },
  status: {
    alignSelf: 'flex-start',
    backgroundColor: colors.softGold,
    borderRadius: 8,
    color: colors.darkGold,
    fontFamily: fonts.medium,
    fontSize: 18,
    marginTop: 6,
    overflow: 'hidden',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  note: { color: colors.gray, fontFamily: fonts.medium, fontSize: 17, marginTop: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
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
