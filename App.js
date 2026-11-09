import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  FlatList,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://vxqioxcbarztfhjtrwhf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7yCtOeZ4UR7V_8jZY3cq4Q_Uqok9Y7V';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CATEGORIES = [
  { id: 'traffic', label: '🚗 Пробка' },
  { id: 'fuel', label: '⛽ Бензин' },
  { id: 'transport', label: '🚌 Транспорт' },
  { id: 'inspectors', label: '🚓 Контролёры' },
  { id: 'police', label: '👮 ДПС' },
];

export default function App() {
  const [location, setLocation] = useState({
    latitude: 54.1961,
    longitude: 37.6182,
  });
  const [pins, setPins] = useState([]);
  const [userId, setUserId] = useState(null);

  const lastPinTime = useRef(0);
  const lastMsgTime = useRef(0);
  const mapRef = useRef(null);

  const [pinCoords, setPinCoords] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedType, setSelectedType] = useState('traffic');
  const [description, setDescription] = useState('');

  const [chatVisible, setChatVisible] = useState(false);
  const [chatSelectorVisible, setChatSelectorVisible] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentCity, setCurrentCity] = useState('Мой город');
  const [currentDistrict, setCurrentDistrict] = useState('Мой район');
  const [activeChat, setActiveChat] = useState('');
  const flatListRef = useRef();

  useEffect(() => {
    const initApp = async () => {
      try {
        let storedId = await AsyncStorage.getItem('@user_id');
        if (!storedId) {
          storedId = Math.random().toString(36).substring(2, 15);
          await AsyncStorage.setItem('@user_id', storedId);
        }
        setUserId(storedId);
      } catch (e) {
        setUserId('fallback_' + Math.random());
      }

      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          let loc = await Location.getLastKnownPositionAsync();
          if (!loc) {
            loc = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
          }

          if (loc) {
            setLocation(loc.coords);
            mapRef.current?.animateToRegion(
              {
                latitude: loc.coords.latitude,
                longitude: loc.coords.longitude,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              },
              1000
            );

            let geocode = await Location.reverseGeocodeAsync(loc.coords);
            if (geocode.length > 0) {
              const city = geocode[0].city || 'Город';
              const district = geocode[0].district || city;
              setCurrentCity(city);
              setCurrentDistrict(district);
              setActiveChat(district);
            }
          }
        }
      } catch (error) {
        console.log('GPS заглушен', error);
        setCurrentCity('Тула');
        setCurrentDistrict('Зареченский');
        setActiveChat('Зареченский');
      } finally {
        fetchPins();
      }
    };
    initApp();

    const pinSub = supabase
      .channel('pins-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pins' },
        (payload) => {
          setPins((prev) => [...prev, payload.new]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'pins' },
        (payload) => {
          setPins((prev) => prev.filter((p) => p.id !== payload.old.id));
        }
      )
      .subscribe();

    const chatSub = supabase
      .channel('chat-channel')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => {
          if (chatVisible) loadChatMessages(activeChat);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(pinSub);
      supabase.removeChannel(chatSub);
    };
  }, [chatVisible, activeChat]);

  const fetchPins = async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('pins')
      .select('*')
      .gte('created_at', twoHoursAgo)
      .order('created_at', { ascending: true });
    if (data) setPins(data);
  };

  const checkCooldown = () => {
    if (Date.now() - lastPinTime.current < 30000) {
      Alert.alert('Не так быстро!', 'Подожди 30 секунд.');
      return false;
    }
    return true;
  };

  const openModalCurrentLocation = () => {
    if (!checkCooldown()) return;
    setPinCoords(location);
    setDescription('');
    setSelectedType('traffic');
    setModalVisible(true);
  };

  const handleLongPress = (coordinate) => {
    if (!checkCooldown()) return;
    setPinCoords(coordinate);
    setDescription('');
    setSelectedType('traffic');
    setModalVisible(true);
  };

  const submitPin = async () => {
    setModalVisible(false);
    const finalCoords = pinCoords || location;
    const { data, error } = await supabase
      .from('pins')
      .insert([
        {
          latitude: finalCoords.latitude,
          longitude: finalCoords.longitude,
          message: description || 'Без описания',
          type: selectedType,
          author_id: userId,
        },
      ])
      .select();

    if (!error && data) {
      lastPinTime.current = Date.now();
    }
  };

  const handleMarkerPress = (pin) => {
    const timeString = new Date(pin.created_at).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const categoryObj = CATEGORIES.find((c) => c.id === pin.type);
    const categoryLabel = categoryObj ? categoryObj.label : '📍 Другое';
    const alertMessage = `Категория: ${categoryLabel}\n\n🕒 Время: ${timeString}\n\n📝 Текст: ${pin.message}`;

    if (pin.author_id === userId || !pin.author_id) {
      Alert.alert('Ваша метка', alertMessage, [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: () => deletePin(pin.id),
        },
      ]);
    } else {
      Alert.alert('Метка пользователя', alertMessage);
    }
  };

  const deletePin = async (id) => {
    await supabase.from('pins').delete().eq('id', id);
  };

  const getMarkerColor = (type) => {
    switch (type) {
      case 'traffic':
        return 'red';
      case 'fuel':
        return 'green';
      case 'transport':
        return 'blue';
      case 'inspectors':
        return 'orange';
      case 'police':
        return 'purple';
      default:
        return 'red';
    }
  };

  const loadChatMessages = async (chatName) => {
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('district', chatName)
      .order('created_at', { ascending: false })
      .limit(50);

    if (data) {
      setChatMessages(data.reverse());
    }
  };

  const openChat = () => {
    setChatVisible(true);
    loadChatMessages(activeChat);
  };

  const changeChat = (newChatName) => {
    setActiveChat(newChatName);
    setChatSelectorVisible(false);
    loadChatMessages(newChatName);
  };

  const sendMessage = async () => {
    const msgText = newMessage.trim();
    if (!msgText) return;

    if (Date.now() - lastMsgTime.current < 2000) {
      Alert.alert('Помедленнее', 'Не так быстро!');
      return;
    }

    const { error } = await supabase.from('chat_messages').insert([
      {
        text: msgText,
        city: currentCity,
        district: activeChat,
        author_id: userId,
      },
    ]);

    if (error) {
      Alert.alert('Ошибка', 'Не удалось отправить сообщение');
    } else {
      lastMsgTime.current = Date.now();
      setNewMessage('');
      loadChatMessages(activeChat);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation={true}
        onLongPress={(e) => handleLongPress(e.nativeEvent.coordinate)}>
        {pins.map((pin) => (
          <Marker
            key={pin.id}
            coordinate={{ latitude: pin.latitude, longitude: pin.longitude }}
            pinColor={getMarkerColor(pin.type)}
            onPress={() => handleMarkerPress(pin)}
            tracksViewChanges={false}
          />
        ))}
      </MapView>

      <TouchableOpacity
        style={styles.button}
        onPress={openModalCurrentLocation}>
        <Text style={styles.buttonText}>📍 Сообщить здесь</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.chatButton} onPress={openChat}>
        <Text style={styles.chatButtonText}>💬</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} animationType="slide" transparent={true}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              style={styles.modalContent}>
              <Text style={styles.modalTitle}>Что случилось?</Text>
              <View style={styles.categoriesContainer}>
                {CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.categoryBtn,
                      selectedType === cat.id && styles.categoryBtnActive,
                    ]}
                    onPress={() => setSelectedType(cat.id)}>
                    <Text
                      style={[
                        styles.categoryText,
                        selectedType === cat.id && styles.categoryTextActive,
                      ]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Детали..."
                multiline={true}
                maxLength={1000}
                value={description}
                onChangeText={setDescription}
              />
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.cancelBtn]}
                  onPress={() => setModalVisible(false)}>
                  <Text style={styles.actionBtnText}>Отмена</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.submitBtn]}
                  onPress={submitPin}>
                  <Text style={styles.actionBtnText}>Отправить</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <Modal visible={chatVisible} animationType="slide" transparent={true}>
        <View style={styles.chatOverlay}>
          <View style={styles.chatContent}>
            <View style={styles.chatHeader}>
              <TouchableOpacity
                onPress={() => setChatSelectorVisible(true)}
                style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.chatTitle}>💬 {activeChat}</Text>
                <Text style={{ fontSize: 16, marginLeft: 5, color: '#E53935' }}>
                  ▼
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setChatVisible(false)}>
                <Text style={styles.closeText}>Закрыть</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              ref={flatListRef}
              data={chatMessages}
              keyExtractor={(item) => item.id.toString()}
              onContentSizeChange={() =>
                flatListRef.current?.scrollToEnd({ animated: true })
              }
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <View
                  style={[
                    styles.messageBubble,
                    item.author_id === userId
                      ? styles.myMessage
                      : styles.theirMessage,
                  ]}>
                  <Text style={styles.messageText}>{item.text}</Text>
                  <Text style={styles.messageTime}>
                    {new Date(item.created_at).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              )}
            />
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <View style={styles.chatInputRow}>
                <TextInput
                  style={styles.chatInput}
                  placeholder="Написать..."
                  value={newMessage}
                  onChangeText={setNewMessage}
                  maxLength={500}
                />
                <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
                  <Text style={styles.sendBtnText}>➤</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={chatSelectorVisible}
        animationType="fade"
        transparent={true}>
        <TouchableWithoutFeedback onPress={() => setChatSelectorVisible(false)}>
          <View style={styles.selectorOverlay}>
            <View style={styles.selectorContent}>
              <Text style={styles.selectorTitle}>Выберите чат</Text>
              <TouchableOpacity
                style={styles.selectorOption}
                onPress={() => changeChat(`${currentCity} (Общий)`)}>
                <Text style={styles.selectorOptionText}>
                  🌐 Общий чат ({currentCity})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.selectorOption}
                onPress={() => changeChat(currentDistrict)}>
                <Text style={styles.selectorOptionText}>
                  📍 Мой район ({currentDistrict})
                </Text>
              </TouchableOpacity>
              <Text
                style={[
                  styles.selectorOptionText,
                  {
                    fontSize: 12,
                    color: '#999',
                    marginTop: 10,
                    textAlign: 'center',
                  },
                ]}>
                Тестовые районы
              </Text>
              <TouchableOpacity
                style={styles.selectorOption}
                onPress={() => changeChat('Центральный')}>
                <Text style={styles.selectorOptionText}>Центральный район</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.selectorOption}
                onPress={() => changeChat('Зареченский')}>
                <Text style={styles.selectorOptionText}>Зареченский район</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },
  button: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: '#E53935',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 30,
    elevation: 5,
  },
  buttonText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  chatButton: {
    position: 'absolute',
    bottom: 40,
    right: 20,
    backgroundColor: 'white',
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  chatButtonText: { fontSize: 30 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  categoriesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 15,
  },
  categoryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: '#f0f0f0',
    margin: 4,
  },
  categoryBtnActive: { backgroundColor: '#E53935' },
  categoryText: { fontSize: 14, color: '#333' },
  categoryTextActive: { color: 'white', fontWeight: 'bold' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 10,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 20,
  },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelBtn: { backgroundColor: '#ccc', marginRight: 10 },
  submitBtn: { backgroundColor: '#E53935' },
  actionBtnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  chatOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  chatContent: {
    backgroundColor: 'white',
    height: '75%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  chatTitle: { fontSize: 18, fontWeight: 'bold' },
  closeText: { fontSize: 16, color: '#E53935', fontWeight: 'bold' },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 15,
    marginVertical: 5,
    marginHorizontal: 15,
  },
  myMessage: {
    backgroundColor: '#E53935',
    alignSelf: 'flex-end',
    borderBottomRightRadius: 2,
  },
  theirMessage: {
    backgroundColor: '#f0f0f0',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 2,
  },
  messageText: { fontSize: 16, color: 'black' },
  messageTime: {
    fontSize: 10,
    color: 'gray',
    alignSelf: 'flex-end',
    marginTop: 5,
  },
  chatInputRow: {
    flexDirection: 'row',
    padding: 15,
    borderTopWidth: 1,
    borderColor: '#eee',
    alignItems: 'center',
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 10,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: '#E53935',
    width: 45,
    height: 45,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnText: { color: 'white', fontSize: 20, marginLeft: 3 },
  selectorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectorContent: {
    backgroundColor: 'white',
    width: '80%',
    borderRadius: 15,
    padding: 20,
  },
  selectorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  selectorOption: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  selectorOptionText: { fontSize: 16, color: '#333', textAlign: 'center' },
});
