import { useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, fonts } from '../theme';
import type { SessionProfile } from '../types';
import { AdminBarberos } from './admin/AdminBarberos';
import { AdminProcedimientos } from './admin/AdminProcedimientos';
import { AdminResenas } from './admin/AdminResenas';

type TabKey = 'barberos' | 'procedimientos' | 'resenas';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'barberos', label: 'Barberos' },
  { key: 'procedimientos', label: 'Procedimientos' },
  { key: 'resenas', label: 'Reseñas' },
];

// Panel del administrador: barberos (RF-07/08/09), procedimientos (RF-11) y reseñas (RF-10).
export function AdminHomeScreen({ profile }: { profile: SessionProfile | null }) {
  const { width } = useWindowDimensions();
  const isCompact = width < 620;
  const barberia = profile?.barberia;
  const [tab, setTab] = useState<TabKey>('barberos');

  return (
    <View>
      <View style={[styles.header, isCompact && styles.headerCompact]}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>Panel del administrador</Text>
          <Text style={styles.title}>Hola, {profile?.nombre || 'Administrador'}</Text>
        </View>
        <Text style={styles.badge}>Administrador</Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.cardLabel}>Tu barbería</Text>
        <Text style={styles.infoTitle}>{barberia?.nombre ?? 'Sin barbería asociada'}</Text>
        {barberia?.direccion ? <Text style={styles.cardText}>{barberia.direccion}</Text> : null}
        {barberia?.telefono ? <Text style={styles.cardText}>{barberia.telefono}</Text> : null}
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

      {tab === 'barberos' ? <AdminBarberos /> : null}
      {tab === 'procedimientos' ? <AdminProcedimientos /> : null}
      {tab === 'resenas' ? <AdminResenas /> : null}
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
  infoCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    marginBottom: 18,
    maxWidth: 520,
    padding: 18,
  },
  cardLabel: { color: colors.muted, fontFamily: fonts.medium, fontSize: 16 },
  infoTitle: { color: colors.black, fontFamily: fonts.title, fontSize: 26 },
  cardText: { color: colors.gray, fontFamily: fonts.medium, fontSize: 18 },
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
});
