import { useState } from 'react';
import { View } from 'react-native';
import api, { setSession } from '../api';
import {
  Feedback,
  formStyles,
  InlineLink,
  Input,
  keyIcon,
  PrimaryButton,
  userIcon,
} from '../components/FormControls';
import type { Session, SessionProfile } from '../types';
import { readError } from '../utils/errors';

export function LoginScreen({
  feedback,
  onFeedback,
  onLoginSuccess,
  onRegister,
  onRegisterBarberia,
}: {
  feedback: string;
  onFeedback: (message: string) => void;
  onLoginSuccess: (profile: SessionProfile) => void;
  onRegister: () => void;
  onRegisterBarberia: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      onFeedback('Ingresa tu correo y tu contraseña.');
      return;
    }

    setLoading(true);
    onFeedback('');

    try {
      // El rol ya no se elige: el backend lo deduce de la cuenta.
      const response = await api.post('/auth/login', { email: email.trim(), password });
      setSession(response.data.session as Session);
      onLoginSuccess(response.data.profile as SessionProfile);
    } catch (error) {
      onFeedback(readError(error, 'No fue posible iniciar sesión'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={formStyles.form}>
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
        icon={keyIcon}
        placeholder="Contraseña"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        secureTextEntry
      />
      <Feedback message={feedback} />
      <PrimaryButton label="Iniciar Sesión" onPress={submit} loading={loading} />
      <InlineLink prefix="¿Eres cliente y no tienes cuenta?" label="Crear cuenta" onPress={onRegister} />
      <InlineLink prefix="¿Tienes una barbería?" label="Registrar mi barbería" onPress={onRegisterBarberia} />
    </View>
  );
}
