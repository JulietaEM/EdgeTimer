import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, fonts } from '../theme';

export const userIcon = require('../../assets/user.png');
export const keyIcon = require('../../assets/key.png');
export const phoneIcon = require('../../assets/phone.png');

export function Input({
  icon,
  ...props
}: ComponentProps<typeof TextInput> & { icon?: number }) {
  return (
    <View style={styles.inputWrap}>
      {icon && <Image source={icon} style={styles.inputIcon} />}
      <TextInput
        placeholderTextColor="#777777"
        style={[styles.input, icon ? styles.inputWithIcon : undefined]}
        {...props}
      />
    </View>
  );
}

export function PrimaryButton({
  label,
  loading,
  onPress,
}: {
  label: string;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && styles.pressed,
        loading && styles.disabledButton,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={styles.primaryText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

export function Checkbox({
  checked,
  children,
  onToggle,
}: {
  checked: boolean;
  children: ReactNode;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={styles.checkboxRow}
    >
      <View style={[styles.checkboxBox, checked && styles.checkboxBoxChecked]}>
        {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
      </View>
      <View style={styles.checkboxLabel}>{children}</View>
    </Pressable>
  );
}

export function InlineLink({
  prefix,
  label,
  onPress,
}: {
  prefix?: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.inlineRow}>
      {prefix && <Text style={styles.smallText}>{prefix} </Text>}
      <Pressable onPress={onPress}>
        <Text style={styles.linkText}>{label}</Text>
      </Pressable>
    </View>
  );
}

export function Feedback({ message }: { message: string }) {
  if (!message) return null;

  const isSuccess = message.toLowerCase().includes('exitoso');

  return (
    <Text
      style={[
        styles.feedback,
        isSuccess ? styles.successText : styles.errorText,
      ]}
    >
      {message}
    </Text>
  );
}

export const formStyles = StyleSheet.create({
  form: {
    width: '100%',
    maxWidth: 420,
    gap: 14,
  },
});

const styles = StyleSheet.create({
  inputWrap: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E6E1DA',
    justifyContent: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: 18,
    width: 20,
    height: 20,
    resizeMode: 'contain',
    tintColor: colors.darkGold,
  },
  input: {
    minHeight: 56,
    paddingHorizontal: 18,
    color: colors.black,
    fontSize: 18,
    fontFamily: fonts.medium,
  },
  inputWithIcon: {
    paddingLeft: 50,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  secondaryButton: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  disabledButton: {
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.82,
  },
  primaryText: {
    color: colors.white,
    fontSize: 18,
    fontFamily: fonts.title,
  },
  secondaryText: {
    color: colors.darkGold,
    fontSize: 18,
    fontFamily: fonts.title,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 2,
  },
  smallText: {
    color: colors.gray,
    fontSize: 16,
    fontFamily: fonts.medium,
  },
  linkText: {
    color: colors.darkGold,
    fontSize: 16,
    fontFamily: fonts.title,
  },
  checkboxRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
  },
  checkboxBox: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.gold,
    borderRadius: 6,
    borderWidth: 1.5,
    height: 24,
    justifyContent: 'center',
    marginTop: 2,
    width: 24,
  },
  checkboxBoxChecked: {
    backgroundColor: colors.gold,
  },
  checkboxMark: {
    color: colors.white,
    fontFamily: fonts.title,
    fontSize: 16,
    lineHeight: 18,
  },
  checkboxLabel: {
    flex: 1,
  },
  feedback: {
    textAlign: 'center',
    fontSize: 16,
    fontFamily: fonts.medium,
  },
  errorText: {
    color: colors.danger,
  },
  successText: {
    color: colors.success,
  },
});
