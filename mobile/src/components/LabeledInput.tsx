import type { ComponentProps } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts } from '../theme';

/** Campo de texto con su etiqueta encima (para formularios dentro de ventanas). */
export function LabeledInput({
  hint,
  label,
  ...props
}: { hint?: string; label: string } & ComponentProps<typeof TextInput>) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={styles.input} {...props} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.black,
    fontFamily: fonts.medium,
    fontSize: 19,
    marginBottom: 7,
  },
  input: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.black,
    fontFamily: fonts.medium,
    fontSize: 19,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  hint: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 16,
    marginTop: 4,
  },
});
