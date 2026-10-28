import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import api from '../../api';
import { colors, fonts } from '../../theme';
import type {
  BarberiaCliente,
  BarberoElegido,
  BarberoListaCliente,
  SessionProfile,
} from '../../types';
import { readError } from '../../utils/errors';

const avatar = require('../../../assets/user.png');

// Inicio del cliente (HU-17): elegir barbería y barbero. Si solo existe una
// barbería, se salta ese paso (RNF-02: el agendamiento no pasa de 5 pasos).
export function ClienteInicioScreen({
  profile,
  onViewBarbero,
  onAgendar,
}: {
  profile: SessionProfile | null;
  onViewBarbero: (barberoId: string) => void;
  onAgendar: (barbero: BarberoElegido) => void;
}) {
  const { width } = useWindowDimensions();
  const isCompact = width < 620;

  const [barberias, setBarberias] = useState<BarberiaCliente[]>([]);
  const [barberiaId, setBarberiaId] = useState<string | null>(null);
  const [barberos, setBarberos] = useState<BarberoListaCliente[]>([]);
  const [loadingBarberias, setLoadingBarberias] = useState(true);
  const [loadingBarberos, setLoadingBarberos] = useState(false);
  const [error, setError] = useState('');

  const barberia = barberias.find((item) => item.id === barberiaId) ?? null;

  useEffect(() => {
    let active = true;

    api
      .get<BarberiaCliente[]>('/cliente/barberias')
      .then((response) => {
        if (!active) return;
        setBarberias(response.data);
        if (response.data.length === 1) setBarberiaId(response.data[0].id);
      })
      .catch((err) => active && setError(readError(err, 'No fue posible cargar las barberías.')))
      .finally(() => active && setLoadingBarberias(false));

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!barberiaId) {
      setBarberos([]);
      return;
    }

    let active = true;
    setLoadingBarberos(true);
    setError('');

    api
      .get<BarberoListaCliente[]>(`/cliente/barberias/${barberiaId}/barberos`)
      .then((response) => active && setBarberos(response.data))
      .catch((err) => active && setError(readError(err, 'No fue posible cargar los barberos.')))
      .finally(() => active && setLoadingBarberos(false));

    return () => {
      active = false;
    };
  }, [barberiaId]);

  return (
    <View>
      <View style={[styles.header, isCompact && styles.headerCompact]}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>Home cliente</Text>
          <Text style={styles.title}>Hola, {profile?.nombre || 'Cliente'}</Text>
        </View>
        <Text style={styles.badge}>Cliente</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!barberiaId ? (
        <View>
          <Text style={styles.sectionTitle}>Elige una barbería</Text>
          {loadingBarberias ? (
            <Text style={styles.empty}>Cargando barberías...</Text>
          ) : barberias.length === 0 ? (
            <Text style={styles.empty}>Aún no hay barberías disponibles.</Text>
          ) : (
            <View style={styles.grid}>
              {barberias.map((item) => (
                <Pressable
                  key={item.id}
                  disabled={item.totalBarberos === 0}
                  style={[
                    styles.card,
                    isCompact && styles.fullWidthCard,
                    item.totalBarberos === 0 && styles.disabled,
                  ]}
                  onPress={() => setBarberiaId(item.id)}
                >
                  <Text style={styles.cardTitle}>{item.nombre}</Text>
                  {item.direccion ? <Text style={styles.cardText}>{item.direccion}</Text> : null}
                  {item.descripcion ? (
                    <Text style={styles.cardText} numberOfLines={2}>
                      {item.descripcion}
                    </Text>
                  ) : null}
                  <Text style={styles.meta}>
                    {item.totalBarberos === 0
                      ? 'Sin barberos por ahora'
                      : item.totalBarberos === 1
                        ? '1 barbero'
                        : `${item.totalBarberos} barberos`}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : (
        <View>
          {barberias.length > 1 ? (
            <Pressable onPress={() => setBarberiaId(null)} style={styles.backButton}>
              <Text style={styles.backText}>← Cambiar barbería</Text>
            </Pressable>
          ) : null}

          <Text style={styles.sectionTitle}>
            {barberia ? `Barberos de ${barberia.nombre}` : 'Barberos'}
          </Text>
          {barberia?.direccion ? <Text style={styles.cardText}>{barberia.direccion}</Text> : null}

          {loadingBarberos ? (
            <Text style={styles.empty}>Cargando barberos...</Text>
          ) : barberos.length === 0 ? (
            <Text style={styles.empty}>Esta barbería todavía no tiene barberos.</Text>
          ) : (
            <View style={[styles.grid, styles.gridTop]}>
              {barberos.map((barbero) => (
                <View key={barbero.id} style={[styles.card, isCompact && styles.fullWidthCard]}>
                  <Image
                    source={barbero.foto ? { uri: barbero.foto } : avatar}
                    style={styles.avatar}
                  />
                  <Text style={styles.cardTitle}>{barbero.nombre}</Text>
                  <Text style={styles.rating}>
                    {barbero.promedioCalificacion > 0
                      ? `★ ${barbero.promedioCalificacion.toFixed(1)}`
                      : 'Sin calificaciones'}
                  </Text>
                  <Text style={styles.cardText} numberOfLines={2}>
                    {barbero.especialidades.join(', ') || 'Servicios generales'}
                  </Text>
                  <Text style={barbero.tieneHorario ? styles.cardText : styles.warning}>
                    {barbero.tieneHorario ? barbero.horarioResumen : 'Aún no tiene horario'}
                  </Text>
                  <View style={styles.actions}>
                    <Pressable
                      disabled={!barbero.tieneHorario}
                      style={[styles.primaryButton, !barbero.tieneHorario && styles.disabled]}
                      onPress={() => onAgendar({ id: barbero.id, nombre: barbero.nombre })}
                    >
                      <Text style={styles.primaryButtonText}>Agendar</Text>
                    </Pressable>
                    <Pressable style={styles.ghostButton} onPress={() => onViewBarbero(barbero.id)}>
                      <Text style={styles.ghostButtonText}>Ver perfil</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 18,
  },
  headerCompact: { alignItems: 'flex-start', flexDirection: 'column', gap: 8 },
  headerText: { flex: 1, minWidth: 0 },
  kicker: { color: colors.darkGold, fontFamily: fonts.medium, fontSize: 21 },
  title: { color: colors.black, fontFamily: fonts.title, fontSize: 36 },
  badge: {
    backgroundColor: colors.black,
    borderRadius: 8,
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 18,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sectionTitle: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 26,
    marginBottom: 8,
    marginTop: 10,
  },
  empty: { color: colors.gray, fontFamily: fonts.medium, fontSize: 20, marginBottom: 20 },
  error: { color: colors.danger, fontFamily: fonts.medium, fontSize: 18, marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  gridTop: { marginTop: 12 },
  card: {
    alignItems: 'flex-start',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 240,
    flexGrow: 1,
    gap: 6,
    minWidth: 210,
    padding: 16,
  },
  fullWidthCard: { width: '100%', minWidth: '100%', flexBasis: '100%' },
  disabled: { opacity: 0.5 },
  avatar: {
    backgroundColor: colors.softGold,
    borderRadius: 39,
    height: 78,
    resizeMode: 'cover',
    width: 78,
  },
  cardTitle: { color: colors.black, fontFamily: fonts.title, fontSize: 21 },
  cardText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
  meta: { color: colors.darkGold, fontFamily: fonts.medium, fontSize: 18, marginTop: 4 },
  rating: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 18 },
  warning: { color: colors.danger, fontFamily: fonts.medium, fontSize: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  primaryButton: {
    backgroundColor: colors.black,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  primaryButtonText: { color: colors.white, fontFamily: fonts.title, fontSize: 16 },
  ghostButton: {
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  ghostButtonText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 16 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8 },
  backText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 16 },
});
