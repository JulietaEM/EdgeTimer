import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import api from '../../api';
import { colors, fonts } from '../../theme';
import type { BarberoAdmin, ResenaAdmin, ResenasAdmin } from '../../types';
import { readError } from '../../utils/errors';

const PAGE = 20;

// Pestaña "Reseñas" del panel del administrador (RF-10).
export function AdminResenas() {
  const { width } = useWindowDimensions();
  const isCompact = width < 620;

  const [barberos, setBarberos] = useState<BarberoAdmin[]>([]);
  const [barberoId, setBarberoId] = useState<string | null>(null);
  const [items, setItems] = useState<ResenaAdmin[]>([]);
  const [resumen, setResumen] = useState<ResenasAdmin['resumen']>({ promedio: 0, total: 0 });
  const [hayMas, setHayMas] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (filter: string | null, offset: number) => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/admin/resenas', {
        params: { limit: PAGE, offset, ...(filter ? { barberoId: filter } : {}) },
      });
      const data = response.data as ResenasAdmin;
      setItems((current) => (offset === 0 ? data.items : [...current, ...data.items]));
      setResumen(data.resumen);
      setHayMas(data.hayMas);
    } catch (err) {
      setError(readError(err, 'No fue posible cargar las reseñas.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    api
      .get('/admin/barberos')
      .then((response) => setBarberos(response.data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load(barberoId, 0);
  }, [barberoId]);

  return (
    <View>
      <View style={styles.summary}>
        <Text style={styles.summaryScore}>★ {resumen.promedio.toFixed(1)}</Text>
        <Text style={styles.summaryText}>
          {resumen.total === 1 ? '1 reseña' : `${resumen.total} reseñas`}
        </Text>
      </View>

      {barberos.length > 0 ? (
        <View style={styles.pillWrap}>
          <FilterPill label="Todos" active={barberoId === null} onPress={() => setBarberoId(null)} />
          {barberos.map((barbero) => (
            <FilterPill
              key={barbero.id}
              label={barbero.nombre}
              active={barberoId === barbero.id}
              onPress={() => setBarberoId(barbero.id)}
            />
          ))}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {items.length === 0 && !error ? (
        <Text style={styles.empty}>
          {loading ? 'Cargando reseñas...' : 'Todavía no hay reseñas para mostrar.'}
        </Text>
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <View key={item.id} style={[styles.card, isCompact && styles.fullWidthCard]}>
              <Text style={styles.stars}>
                {'★'.repeat(item.puntuacion)}
                <Text style={styles.starsOff}>{'★'.repeat(5 - item.puntuacion)}</Text>
              </Text>
              {item.comentario ? (
                <Text style={styles.comment}>{item.comentario}</Text>
              ) : (
                <Text style={styles.noComment}>Sin comentario</Text>
              )}
              <Text style={styles.meta}>
                {item.cliente} · atendido por {item.barbero}
              </Text>
              {item.servicios.length > 0 ? (
                <Text style={styles.meta}>{item.servicios.join(', ')}</Text>
              ) : null}
              <Text style={styles.date}>{formatDate(item.fecha)}</Text>
            </View>
          ))}
        </View>
      )}

      {hayMas ? (
        <Pressable
          style={[styles.moreButton, loading && styles.disabled]}
          disabled={loading}
          onPress={() => load(barberoId, items.length)}
        >
          <Text style={styles.moreButtonText}>{loading ? 'Cargando...' : 'Ver más'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FilterPill({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.pill, active && styles.pillSelected]} onPress={onPress}>
      <Text style={[styles.pillText, active && styles.pillTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Bogota',
  });
}

const styles = StyleSheet.create({
  summary: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  summaryScore: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 36 },
  summaryText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 20 },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
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
  empty: { color: colors.gray, fontFamily: fonts.medium, fontSize: 20, marginBottom: 20 },
  error: { color: colors.danger, fontFamily: fonts.medium, fontSize: 18, marginBottom: 12 },
  list: { gap: 12, maxWidth: 720 },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 16,
  },
  fullWidthCard: { width: '100%' },
  stars: { color: colors.gold, fontFamily: fonts.title, fontSize: 22 },
  starsOff: { color: colors.border },
  comment: { color: colors.black, fontFamily: fonts.medium, fontSize: 19 },
  noComment: { color: colors.muted, fontFamily: fonts.medium, fontSize: 18 },
  meta: { color: colors.gray, fontFamily: fonts.medium, fontSize: 17 },
  date: { color: colors.muted, fontFamily: fonts.medium, fontSize: 15, marginTop: 2 },
  moreButton: {
    alignSelf: 'flex-start',
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  moreButtonText: { color: colors.darkGold, fontFamily: fonts.title, fontSize: 17 },
  disabled: { opacity: 0.6 },
});
