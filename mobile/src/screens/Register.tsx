import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import api from '../api';
import {
  Checkbox,
  Feedback,
  formStyles,
  InlineLink,
  Input,
  keyIcon,
  PrimaryButton,
  userIcon,
  phoneIcon,
} from '../components/FormControls';
import { PolicyModal } from '../components/PolicyModal';
import { colors, fonts } from '../theme';
import { readError } from '../utils/errors';

export function RegisterScreen({
  feedback,
  onFeedback,
  onBackToLogin,
  onRegistered,
}: {
  feedback: string;
  onFeedback: (message: string) => void;
  onBackToLogin: () => void;
  onRegistered: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (password !== confirm) {
      onFeedback('Las contraseñas no coinciden.');
      return;
    }
    if (!accepted) {
      onFeedback('Debes aceptar la política de tratamiento de datos personales.');
      return;
    }

    setLoading(true);
    onFeedback('');

    try {
      await api.post('/auth/register-client', {
        nombre,
        email,
        telefono,
        password,
        aceptaTerminos: accepted,
      });
      onRegistered();
    } catch (error) {
      onFeedback(readError(error, 'No fue posible crear la cuenta'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={formStyles.form}>
      <Input icon={userIcon} placeholder="Nombre" value={nombre} onChangeText={setNombre} />
      <Input
        icon={userIcon}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <Input
        icon={phoneIcon}
        placeholder="Teléfono (opcional)"
        value={telefono}
        onChangeText={setTelefono}
        keyboardType="phone-pad"
      />
      <Input
        icon={keyIcon}
        placeholder="Contraseña (8+ caracteres, letras y números)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Input
        icon={keyIcon}
        placeholder="Confirmar contraseña"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
      />
      <Checkbox checked={accepted} onToggle={() => setAccepted((value) => !value)}>
        <Text style={styles.terms}>
          Acepto la{' '}
          <Pressable onPress={() => setPolicyOpen(true)}>
            <Text style={styles.termsLink}>política de tratamiento de datos personales</Text>
          </Pressable>
        </Text>
      </Checkbox>
      <Feedback message={feedback} />
      <PrimaryButton label="Registrarse" onPress={submit} loading={loading} />
      <InlineLink prefix="¿Ya tienes cuenta?" label="Iniciar Sesión" onPress={onBackToLogin} />
      <PolicyModal open={policyOpen} onClose={() => setPolicyOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  terms: {
    color: colors.gray,
    fontFamily: fonts.medium,
    fontSize: 16,
  },
  termsLink: {
    color: colors.darkGold,
    fontFamily: fonts.title,
    fontSize: 16,
    textDecorationLine: 'underline',
  },
});
