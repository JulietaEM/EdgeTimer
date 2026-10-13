import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, fonts } from '../theme';
import type { SessionProfile } from '../types';

// Pantalla provisional del administrador (módulo 1). En el módulo 2 aquí van
// los barberos, procedimientos y reseñas de la barbería.
export function AdminHomeScreen({ profile }: { profile: SessionProfile | null }) {
  const { width } = useWindowDimensions();
  const isCompact = width < 620;
  const barberia = profile?.barberia;

  return (
    <View>
      <View style={[styles.header, isCompact && styles.headerCompact]}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>Panel del administrador</Text>
          <Text style={styles.title}>Hola, {profile?.nombre || 'Administrador'}</Text>
        </View>
        <Text style={styles.badge}>Administrador</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Tu barbería</Text>
        <Text style={styles.cardTitle}>{barberia?.nombre ?? 'Sin barbería asociada'}</Text>
        {barberia?.direccion ? <Text style={styles.cardText}>{barberia.direccion}</Text> : null}
        {barberia?.telefono ? <Text style={styles.cardText}>{barberia.telefono}</Text> : null}
      </View>

      <Text style={styles.note}>
        Pronto podrás administrar aquí a tus barberos, tus procedimientos y las reseñas de tus
        clientes.
      </Text>
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
  headerCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 8,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    color: colors.darkGold,
    fontFamily: fonts.medium,
    fontSize: 21,
  },
  title: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 36,
  },
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
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    marginBottom: 18,
    maxWidth: 520,
    padding: 18,
  },
  cardLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 16,
  },
  cardTitle: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 26,
  },
  cardText: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 18,
  },
  note: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 19,
    maxWidth: 520,
  },
});
