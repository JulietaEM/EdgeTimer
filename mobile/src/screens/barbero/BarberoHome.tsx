import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import api from '../../api';
import { colors, fonts } from '../../theme';
import type { AppScreen, CitaBarbero, CitasBarbero, ResumenBarbero, SessionProfile } from '../../types';
import { readError } from '../../utils/errors';
import { CitaBarberoCard } from './CitaBarberoCard';
import { MotivoModal } from './CitaModals';

// Inicio del barbero (RF-13, RF-14): solicitudes por responder y próximas citas.
export function BarberoHomeScreen({
  profile,
  onNavigate,
}: {
  profile: SessionProfile | null;
  onNavigate: (screen: AppScreen) => void;
}) {
  const { width } = useWindowDimensions();
  const isCompact = width < 620;

  const [resumen, setResumen] = useState<ResumenBarbero | null>(null);
  const [solicitudes, setSolicitudes] = useState<CitaBarbero[]>([]);
  const [proximas, setProximas] = useState<CitaBarbero[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [rejecting, setRejecting] = useState<CitaBarbero | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 4000);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [resumenRes, solicitudesRes, proximasRes] = await Promise.all([
        api.get('/barbero/resumen'),
        api.get('/barbero/citas', { params: { grupo: 'solicitudes' } }),
        api.get('/barbero/citas', { params: { grupo: 'proximas' } }),
      ]);
      setResumen(resumenRes.data);
      setSolicitudes((solicitudesRes.data as CitasBarbero).items);
      setProximas((proximasRes.data as CitasBarbero).items.slice(0, 5));
    } catch (error) {
      showToast(readError(error, 'No fue posible cargar tu inicio.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const accept = async (cita: CitaBarbero) => {
    try {
      const response = await api.patch(`/barbero/citas/${cita.id}/aceptar`);
      showToast(response.data.message);
    } catch (error) {
      showToast(readError(error, 'No fue posible aceptar la solicitud.'));
    }
    load();
  };

  return (
    <View>
      <View style={[styles.header, isCompact && styles.headerCompact]}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>Home barbero</Text>
          <Text style={styles.title}>Hola, {profile?.nombre || 'Barbero'}</Text>
        </View>
        <Text style={styles.badge}>Barbero</Text>
      </View>

      {resumen && !resumen.tieneDisponibilidad ? (
        <View style={styles.callout}>
          <Text style={styles.calloutTitle}>Configura tu disponibilidad</Text>
          <Text style={styles.calloutText}>
            Mientras no definas los días y horas en que atiendes, los clientes no podrán agendar
            contigo.
          </Text>
          <Pressable style={styles.calloutButton} onPress={() => onNavigate('disponibilidad')}>
            <Text style={styles.calloutButtonText}>Configurar ahora</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{resumen?.solicitudesPendientes ?? '–'}</Text>
          <Text style={styles.statLabel}>Solicitudes por responder</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{resumen?.citasHoy ?? '–'}</Text>
          <Text style={styles.statLabel}>Citas hoy</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Solicitudes de citas</Text>
      {solicitudes.length === 0 ? (
        <Text style={styles.empty}>
          {loading ? 'Cargando solicitudes...' : 'No tienes solicitudes pendientes.'}
        </Text>
      ) : (
        <View style={styles.grid}>
          {solicitudes.map((cita) => (
            <CitaBarberoCard
              key={cita.id}
              cita={cita}
              compact={isCompact}
              onAccept={() => accept(cita)}
              onReject={() => setRejecting(cita)}
            />
          ))}
        </View>
      )}

      <Text style={styles.sectionTitle}>Próximas citas</Text>
      {proximas.length === 0 ? (
        <Text style={styles.empty}>
          {loading ? 'Cargando citas...' : 'No tienes citas confirmadas próximas.'}
        </Text>
      ) : (
        <View style={styles.grid}>
          {proximas.map((cita) => (
            <CitaBarberoCard key={cita.id} cita={cita} compact={isCompact} />
          ))}
        </View>
      )}

      <MotivoModal
        action="rechazar"
        cita={rejecting}
        onClose={() => setRejecting(null)}
        onDone={(message) => {
          setRejecting(null);
          showToast(message);
          load();
        }}
      />

      {toast ? <Text style={styles.toast}>{toast}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerCompact: { alignItems: 'flex-start', flexDirection: 'column', gap: 8 },
  headerText: { flex: 1, minWidth: 0 },
  kicker: { color: colors.darkGold, fontFamily: fonts.medium, fontSize: 21 },
  title: { color: colors.black, fontFamily: fonts.title, fontSize: 36 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.black,
    borderRadius: 8,
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 18,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  callout: {
    backgroundColor: colors.softGold,
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    marginBottom: 18,
    maxWidth: 620,
    padding: 16,
  },
  calloutTitle: { color: colors.black, fontFamily: fonts.title, fontSize: 21 },
  calloutText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
  calloutButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.gold,
    borderRadius: 8,
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  calloutButtonText: { color: colors.white, fontFamily: fonts.title, fontSize: 17 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 8 },
  stat: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 180,
    padding: 16,
  },
  statNumber: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 34 },
  statLabel: { color: colors.gray, fontFamily: fonts.medium, fontSize: 17 },
  sectionTitle: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 26,
    marginBottom: 12,
    marginTop: 14,
  },
  empty: { color: colors.gray, fontFamily: fonts.medium, fontSize: 20, marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
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
