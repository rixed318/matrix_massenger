import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { MatrixSessionProvider, useMatrixSession } from './src/context/MatrixSessionContext';
import { LoginScreen } from './src/screens/LoginScreen';
import { ChatListScreen } from './src/screens/ChatListScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { CallScreen } from './src/screens/CallScreen';
import { RootStackParamList } from './src/types/navigation';
import { usePushNotifications } from './src/hooks/usePushNotifications';

const Stack = createNativeStackNavigator<RootStackParamList>();

const AuthenticatedNavigator = () => {
  const { session, logout } = useMatrixSession();
  usePushNotifications(session);

  if (!session) {
    return null;
  }

  return (
    <Stack.Navigator
      initialRouteName="Chats"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#0B1526' },
      }}
    >
      <Stack.Screen name="Chats">
        {props => <ChatListScreen {...props} session={session} onLogout={logout} />}
      </Stack.Screen>
      <Stack.Screen name="Chat">
        {props => <ChatScreen {...props} session={session} />}
      </Stack.Screen>
      <Stack.Screen name="Call">
        {props => <CallScreen {...props} session={session} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
};

const RootNavigator = () => {
  const {
    session,
    loginWithPassword,
    loginWithToken,
    loginWithSso,
    beginQrLogin,
    cancelQrLogin,
    qrLoginState,
    mfaState,
    isLoading,
    error,
    clearError,
  } = useMatrixSession();

  if (!session) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login">
          {() => (
            <LoginScreen
              onSubmit={loginWithPassword}
              onTokenLogin={loginWithToken}
              onSsoLogin={loginWithSso}
              onGenerateQr={beginQrLogin}
              onCancelQr={cancelQrLogin}
              loading={isLoading}
              error={error}
              qrState={qrLoginState}
              mfaState={mfaState}
              onClearError={clearError}
            />
          )}
        </Stack.Screen>
      </Stack.Navigator>
    );
  }

  return <AuthenticatedNavigator />;
};

const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MatrixSessionProvider>
    {children}
  </MatrixSessionProvider>
);

export default function App() {
  return (
    <Providers>
      <StatusBar style="light" />
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </Providers>
  );
}
