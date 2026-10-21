import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import api from '../../api';
import { colors, fonts } from '../../theme';
import type { BloqueDisponibilidad, CitaBarbero, CitasBarbero } from '../../types';
import { readError } from '../../utils/errors';
import { CitaBarberoCard } from './CitaBarberoCard';
import { MotivoModal, ReprogramModal } from './CitaModals';

type TabKey = 'proximas' | 'solicitudes' | 'historial';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'proximas', label: 'Próximas' },
  { key: 'solicitudes', label: 'Solicitudes' },
  { key: 'historial', label: 'Historial' },
];

const PAGE = 20;

// Agenda del barbero (RF-13, RF-14, RF-15): aceptadas, solicitudes e historial.
export function BarberoAgendaScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 620;

  const [tab, setTab] = useState<TabKey>('proximas');
  const [items, setItems] = useState<CitaBarbero[]>([]);
  const [hayMas, setHayMas] = useState(false);
  const [bloques, setBloques] = useState<BloqueDisponibilidad[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [rejecting, setRejecting] = useState<CitaBarbero | null>(null);
  const [cancelling, setCancelling] = useState<CitaBarbero | null>(null);
  const [reprogramming, setReprogramming] = useState<CitaBarbero | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 4000);
  };

  const load = async (target: TabKey, offset = 0) => {
    setLoading(true);
    try {
      const response = await api.get('/barbero/citas', {
        params: { grupo: target, offset, limit: PAGE },
      });
      const data = response.data as CitasBarbero;
      setItems((current) => (offset === 0 ? data.items : [...current, ...data.items]));
      setHayMas(data.hayMas);
    } catch (error) {
      showToast(readError(error, 'No fue posible cargar tus citas.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api
      .get('/barbero/disponibilidad')
      .then((response) => setBloques(response.data.bloques))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setItems([]);
    load(tab);
  }, [tab]);

  const accept = async (cita: CitaBarbero) => {
    try {
      const response = await api.patch(`/barbero/citas/${cita.id}/aceptar`);
      showToast(response.data.message);
    } catch (error) {
      showToast(readError(error, 'No fue posible aceptar la solicitud.'));
    }
    load(tab);
  };

  const done = (message: string) => {
    setRejecting(null);
    setCancelling(null);
    setReprogramming(null);
    showToast(message);
    load(tab);
  };

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.kicker}>Agenda barbero</Text>
        <Text style={styles.title}>Mis citas</Text>
      </View>

      <View style={styles.tabs}>
        {TABS.map((item) => (
          <Pressable
            key={item.key}
            style={[styles.tab, tab === item.key && styles.tabActive]}
            onPress={() => setTab(item.key)}
          >
            <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {items.length === 0 ? (
        <Text style={styles.empty}>
          {loading ? 'Cargando citas...' : EMPTY_TEXT[tab]}
        </Text>
      ) : (
        <View style={styles.grid}>
          {items.map((cita) => (
            <CitaBarberoCard
              key={cita.id}
              cita={cita}
              compact={isCompact}
              onAccept={tab === 'solicitudes' ? () => accept(cita) : undefined}
              onReject={tab === 'solicitudes' ? () => setRejecting(cita) : undefined}
              onReprogram={tab !== 'historial' ? () => setReprogramming(cita) : undefined}
              onCancel={tab !== 'historial' ? () => setCancelling(cita) : undefined}
            />
          ))}
        </View>
      )}

      {hayMas ? (
        <Pressable
          style={[styles.more, loading && styles.disabled]}
          disabled={loading}
          onPress={() => load(tab, items.length)}
        >
          <Text style={styles.moreText}>{loading ? 'Cargando...' : 'Ver más'}</Text>
        </Pressable>
      ) : null}

      <MotivoModal action="rechazar" cita={rejecting} onClose={() => setRejecting(null)} onDone={done} />
      <MotivoModal action="cancelar" cita={cancelling} onClose={() => setCancelling(null)} onDone={done} />
      <ReprogramModal
        bloques={bloques}
        cita={reprogramming}
        onClose={() => setReprogramming(null)}
        onDone={done}
      />

      {toast ? <Text style={styles.toast}>{toast}</Text> : null}
    </View>
  );
}

const EMPTY_TEXT: Record<TabKey, string> = {
  proximas: 'No tienes citas confirmadas próximas.',
  solicitudes: 'No tienes solicitudes pendientes.',
  historial: 'Aún no tienes citas en el historial.',
};

const styles = StyleSheet.create({
  header: { marginBottom: 18 },
  kicker: { color: colors.darkGold, fontFamily: fonts.medium, fontSize: 21 },
  title: { color: colors.black, fontFamily: fonts.title, fontSize: 36 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  tab: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  tabActive: { backgroundColor: colors.black, borderColor: colors.black },
  tabText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
  tabTextActive: { color: colors.white },
  empty: { color: colors.gray, fontFamily: fonts.medium, fontSize: 20, marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  more: {
    alignSelf: 'flex-start',
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  moreText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 17 },
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
