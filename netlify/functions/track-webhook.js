const admin = require('firebase-admin');

let firebaseInitialized = false;

exports.handler = async (event, context) => {
  console.log('🔗 Webhook запрос:', event.httpMethod);

  // Инициализируем Firebase только при первом вызове
  if (!firebaseInitialized) {
    try {
      // Проверяем переменные окружения
      if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error('Firebase переменные окружения не найдены');
      }

      const serviceAccount = {
        type: "service_account",
        project_id: "pulse-fm-84a48",
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
      };

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://pulse-fm-84a48-default-rtdb.firebaseio.com"
      });

      firebaseInitialized = true;
      console.log('✅ Firebase инициализирован успешно');
    } catch (error) {
      console.error('❌ Ошибка инициализации Firebase:', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          error: 'Firebase initialization failed',
          details: error.message 
        })
      };
    }
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Обработка preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Только POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Only POST method allowed' })
    };
  }

  try {
    const db = admin.firestore();
    
    // Парсим данные от myradio24
    const trackData = JSON.parse(event.body || '{}');
    console.log('📀 Получен трек:', trackData.song || 'unknown');
    
    // Простая обработка названия
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
    
    // Простой ID
    const trackId = (artist + '_' + title)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .substring(0, 50);
    
    // Добавляем в Firebase
    const docRef = db.collection('new_tracks').doc(trackId);
    const doc = await docRef.get();
    
    const trackInfo = {
      title: title,
      artist: artist,
      fullSong: song,
      addedToLibrary: new Date(),
      firstPlayed: new Date(),
      isNew: true,
      listeners: trackData.listeners || 0,
      genre: trackData.genre || 'unknown'
    };
    
    if (!doc.exists) {
      await docRef.set(trackInfo);
      console.log('✨ Новый трек добавлен:', artist, '-', title);
    } else {
      await docRef.update({
        lastPlayed: new Date(),
        listeners: trackData.listeners || 0
      });
      console.log('🔄 Трек обновлен:', artist, '-', title);
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        track: { artist, title },
        action: doc.exists ? 'updated' : 'added'
      })
    };
    
  } catch (error) {
    console.error('💥 Ошибка обработки:', error);
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
