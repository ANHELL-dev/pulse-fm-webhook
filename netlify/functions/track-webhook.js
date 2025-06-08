const admin = require('firebase-admin');

// Инициализация Firebase Admin (только один раз)
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: "pulse-fm-84a48",
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
    console.log('✅ Firebase инициализирован');
  } catch (error) {
    console.error('❌ Ошибка Firebase:', error);
  }
}

const db = admin.firestore();

// Основная функция-обработчик
exports.handler = async (event, context) => {
  console.log('🔗 Webhook вызван:', event.httpMethod);

  // CORS заголовки
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Обработка preflight запроса
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Только POST запросы
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Only POST allowed' })
    };
  }

  try {
    // Парсим данные
    const trackData = JSON.parse(event.body || '{}');
    console.log('📀 Данные трека:', trackData.song || 'unknown');
    
    // Извлекаем информацию
    const song = trackData.song || 'Unknown Track';
    let artist = 'Unknown Artist';
    let title = 'Unknown Title';
    
    if (song.includes(' - ')) {
      const parts = song.split(' - ');
      artist = parts[0].trim();
      title = parts.slice(1).join(' - ').trim();
    } else {
      title = song;
    }
    
    // Создаем ID
    const trackId = artist.toLowerCase().replace(/[^a-z0-9]/g, '_') + '__' + 
                   title.toLowerCase().replace(/[^a-z0-9]/g, '_');
    
    // Проверяем и добавляем в новинки
    const docRef = db.collection('new_tracks').doc(trackId.substring(0, 50));
    const doc = await docRef.get();
    
    if (!doc.exists) {
      await docRef.set({
        title: title,
        artist: artist,
        fullSong: song,
        addedToLibrary: admin.firestore.FieldValue.serverTimestamp(),
        firstPlayed: admin.firestore.FieldValue.serverTimestamp(),
        isNew: true,
        listeners: trackData.listeners || 0
      });
      console.log('✨ Новый трек добавлен:', artist, '-', title);
    } else {
      console.log('🔄 Трек уже существует:', artist, '-', title);
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        track: { artist, title, trackId },
        message: doc.exists ? 'Updated' : 'Added'
      })
    };
    
  } catch (error) {
    console.error('💥 Ошибка:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: error.message,
        success: false 
      })
    };
  }
};
