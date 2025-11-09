import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useChats } from '@matrix-messenger/core';
import { ChatListItem } from '../components/ChatListItem';
import { MatrixSessionWithAccount } from '../context/MatrixSessionContext';
import { RootStackParamList } from '../types/navigation';

interface ChatListScreenProps {
  session: MatrixSessionWithAccount;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Chats'>;
  onLogout: () => Promise<void>;
}

export const ChatListScreen: React.FC<ChatListScreenProps> = ({ session, navigation, onLogout }) => {
  const { filteredRooms, isLoading, refresh, searchTerm, setSearchTerm } = useChats({
    client: session.client,
    savedMessagesRoomId: session.savedMessagesRoomId ?? '',
  });

  const handleOpenRoom = useCallback((roomId: string, name: string) => {
    navigation.navigate('Chat', { roomId, roomName: name });
  }, [navigation]);

  const renderItem = useCallback(({ item }: any) => (
    <ChatListItem room={item} onPress={() => handleOpenRoom(item.roomId, item.name)} />
  ), [handleOpenRoom]);

  const rooms = useMemo(() => filteredRooms, [filteredRooms]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Чаты</Text>
        <Text style={styles.subtitle}>{session.displayName ?? session.account.user_id}</Text>
        <TextInput
          style={styles.search}
          placeholder="Поиск"
          placeholderTextColor="#6c7aa6"
          value={searchTerm}
          onChangeText={setSearchTerm}
        />
        <TouchableOpacity style={styles.logoutButton} onPress={onLogout} accessibilityRole="button">
          <Text style={styles.logoutText}>Выйти</Text>
        </TouchableOpacity>
      </View>
      {isLoading ? (
        <View style={styles.loading}> 
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={item => item.roomId}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor="#fff" />}
          ListEmptyComponent={<Text style={styles.empty}>У вас пока нет чатов</Text>}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1526',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 12,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9ba9c5',
    fontSize: 14,
  },
  search: {
    backgroundColor: '#101d35',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#fff',
  },
  logoutButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#1f2a44',
    borderRadius: 10,
  },
  logoutText: {
    color: '#ff6b6b',
    fontWeight: '600',
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  empty: {
    color: '#9ba9c5',
    textAlign: 'center',
    marginTop: 48,
    fontSize: 16,
  },
});
