import { useState } from 'react';
import { View } from 'react-native';
import api from '../api';
import {
  Feedback,
  formStyles,
  InlineLink,
  Input,
  PrimaryButton,
  userIcon,
} from '../components/FormControls';
import { readError } from '../utils/errors';

export function ForgotPasswordScreen({
  feedback,
  onFeedback,
  onBackToLogin,
}: {
  feedback: string;
  onFeedback: (message: string) => void;
  onBackToLogin: () => void;
}) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email.trim()) {
      onFeedback('Ingresa tu correo.');
      return;
    }

    setLoading(true);
    onFeedback('');

    try {
      const response = await api.post('/auth/forgot-password', { email: email.trim() });
      onFeedback(response.data.message);
    } catch (error) {
      onFeedback(readError(error, 'No fue posible enviar el correo.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={formStyles.form}>
      <Input
        icon={userIcon}
        placeholder="Email de tu cuenta"
        value={email}
        onChangeText={setEmail}
        onSubmitEditing={submit}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <Feedback message={feedback} />
      <PrimaryButton label="Enviar enlace" onPress={submit} loading={loading} />
      <InlineLink label="Volver a iniciar sesión" onPress={onBackToLogin} />
    </View>
  );
}
