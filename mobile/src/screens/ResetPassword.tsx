import { useState } from 'react';
import { View } from 'react-native';
import api from '../api';
import {
  Feedback,
  formStyles,
  InlineLink,
  Input,
  keyIcon,
  PrimaryButton,
} from '../components/FormControls';
import { readError } from '../utils/errors';

export function ResetPasswordScreen({
  feedback,
  tokenHash,
  onFeedback,
  onBackToLogin,
  onDone,
}: {
  feedback: string;
  tokenHash: string;
  onFeedback: (message: string) => void;
  onBackToLogin: () => void;
  onDone: (message: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (password !== confirm) {
      onFeedback('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    onFeedback('');

    try {
      const response = await api.post('/auth/reset-password', { tokenHash, password });
      onDone(response.data.message);
    } catch (error) {
      onFeedback(readError(error, 'No fue posible cambiar la contraseña.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={formStyles.form}>
      <Input
        icon={keyIcon}
        placeholder="Contraseña nueva (8+ caracteres, letras y números)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Input
        icon={keyIcon}
        placeholder="Confirmar contraseña nueva"
        value={confirm}
        onChangeText={setConfirm}
        onSubmitEditing={submit}
        secureTextEntry
      />
      <Feedback message={feedback} />
      <PrimaryButton label="Cambiar contraseña" onPress={submit} loading={loading} />
      <InlineLink label="Volver a iniciar sesión" onPress={onBackToLogin} />
    </View>
  );
}
