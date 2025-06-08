const admin = require('firebase-admin');

// Инициализация Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccount = {
      projectId: "pulse-fm-84a48",
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    };

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    
    console.log('Firebase Admin инициализирован успешно');
  } catch (error) {
    console.error('Ошибка инициализации Firebase:', error);
  }
}

const db = admin.firestore();

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Обработка OPTIONS запроса (preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Разрешаем только POST запросы
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Парсим данные от myradio24
    const trackData = JSON.parse(event.body);
    
    console.log('Получены данные трека:', trackData);
    
    // Извлекаем информацию о треке
    const song = trackData.song || '';
    let artist = 'Неизвестный исполнитель';
    let title = 'Неизвестный трек';
    
    // Парсим название трека
    if (song.includes(' - ')) {
      const parts = song.split(' - ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    } else if (song.includes(' – ')) {
      const parts = song.split(' – ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' – ').trim();
    } else {
      title = song;
    }
    
    // Создаем читаемый ID
    function createReadableId(artist, title) {
      const cleanArtist = artist.replace(/[^a-zA-Z0-9а-яА-Я\s]/g, '').replace(/\s+/g, '_').toLowerCase();
      const cleanTitle = title.replace(/[^a-zA-Z0-9а-яА-Я\s]/g, '').replace(/\s+/g, '_').toLowerCase();
      return `${cleanArtist}__${cleanTitle}`.substring(0, 50);
    }
    
    const trackId = createReadableId(artist, title);
    const now = admin.firestore.FieldValue.serverTimestamp();
    
    // Проверяем существование трека в новинках
    const existingNewTrack = await db.collection('new_tracks').doc(trackId).get();
    
    if (!existingNewTrack.exists) {
      // Это новый трек! Добавляем в новинки
      await db.collection('new_tracks').doc(trackId).set({
        title: title,
        artist: artist,
        fullSong: song,
        genre: trackData.genre || 'unknown',
        djname: trackData.djname || 'PULSE FM',
        addedToLibrary: now,
        firstPlayed: now,
        isNew: true,
        port: trackData.port || '',
        listeners: trackData.listeners || 0,
        playCount: 1
      });
      
      console.log(`✨ Новый трек добавлен: ${artist} - ${title}`);
    } else {
      // Обновляем существующий трек
      await db.collection('new_tracks').doc(trackId).update({
        lastPlayed: now,
        listeners: trackData.listeners || 0,
        playCount: admin.firestore.FieldValue.increment(1)
      });
      
      console.log(`🔄 Трек обновлен: ${artist} - ${title}`);
    }
    
    // Возвращаем успешный ответ
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Track processed successfully',
        track: { artist, title, trackId },
        isNew: !existingNewTrack.exists
      })
    };
    
  } catch (error) {
    console.error('Ошибка обработки webhook:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
