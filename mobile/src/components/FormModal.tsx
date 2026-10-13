import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

export function FormModal({
  children,
  danger,
  loading,
  open,
  submitLabel,
  title,
  onClose,
  onSubmit,
}: {
  children: ReactNode;
  danger?: boolean;
  loading?: boolean;
  open: boolean;
  submitLabel: string;
  title: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal animationType="fade" transparent visible={open} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={styles.secondary} onPress={onClose} disabled={loading}>
              <Text style={styles.secondaryText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[styles.submit, danger && styles.submitDanger, loading && styles.disabled]}
              onPress={onSubmit}
              disabled={loading}
            >
              <Text style={styles.submitText}>{loading ? 'Procesando...' : submitLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(17,17,17,0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 8,
    maxHeight: '92%',
    maxWidth: 560,
    padding: 20,
    width: '100%',
  },
  title: {
    color: colors.black,
    fontFamily: fonts.title,
    fontSize: 28,
    marginBottom: 12,
  },
  scrollContent: {
    gap: 12,
    paddingBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  secondary: {
    borderColor: colors.gold,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  secondaryText: {
    color: colors.darkGold,
    fontFamily: fonts.title,
    fontSize: 17,
  },
  submit: {
    backgroundColor: colors.gold,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  submitDanger: {
    backgroundColor: colors.danger,
  },
  submitText: {
    color: colors.white,
    fontFamily: fonts.title,
    fontSize: 17,
  },
  disabled: {
    opacity: 0.6,
  },
});
