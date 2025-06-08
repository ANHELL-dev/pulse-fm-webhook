const admin = require('firebase-admin');

// Функция инициализации Firebase
function initializeFirebase() {
    if (admin.apps.length > 0) {
        return true;
    }
    
    try {
        const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
        
        if (!serviceAccountJson) {
            throw new Error('FIREBASE_SERVICE_ACCOUNT not found');
        }
        
        const serviceAccount = JSON.parse(serviceAccountJson);
        
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id
        });
        
        return true;
    } catch (error) {
        console.error('Firebase init error:', error);
        return false;
    }
}

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
    };
    
    try {
        console.log('📊 === ЗАПРОС СТАТУСА ===');
        
        // Проверяем наличие переменной окружения
        const hasServiceAccount = !!process.env.FIREBASE_SERVICE_ACCOUNT;
        
        console.log('🔍 Service account variable exists:', hasServiceAccount);
        
        if (!hasServiceAccount) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    status: 'error',
                    message: 'FIREBASE_SERVICE_ACCOUNT environment variable not configured',
                    timestamp: new Date().toISOString()
                })
            };
        }
        
        // Пробуем парсить JSON
        let serviceAccountData = null;
        try {
            serviceAccountData = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            console.log('✅ Service account JSON parsed successfully');
        } catch (parseError) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    status: 'error',
                    message: 'Invalid JSON in FIREBASE_SERVICE_ACCOUNT',
                    error: parseError.message,
                    timestamp: new Date().toISOString()
                })
            };
        }
        
        // Инициализируем Firebase
        if (!initializeFirebase()) {
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({
                    status: 'error',
                    message: 'Firebase initialization failed',
                    timestamp: new Date().toISOString()
                })
            };
        }
        
        console.log('✅ Firebase инициализирован');
        
        // Тестируем Firestore
        const db = admin.firestore();
        
        let stats = {};
        let recentTracks = [];
        let firestoreConnected = false;
        
        try {
            // Получаем статистику
            const [newTracksSnap, knownTracksSnap] = await Promise.all([
                db.collection('new_tracks').count().get(),
                db.collection('known_tracks').count().get()
            ]);
            
            stats = {
                totalNewTracks: newTracksSnap.data().count,
                totalKnownTracks: knownTracksSnap.data().count
            };
            
            // Получаем последние треки
            const recentTracksSnap = await db.collection('new_tracks')
                .orderBy('addedToLibrary', 'desc')
                .limit(5)
                .get();
            
            recentTracks = recentTracksSnap.docs.map(doc => {
                const data = doc.data();
                return {
                    artist: data.artist,
                    title: data.title,
                    addedAt: data.addedToLibrary?.toDate()?.toISOString()
                };
            });
            
            firestoreConnected = true;
            console.log('✅ Firestore подключение работает');
            
        } catch (firestoreError) {
            console.error('❌ Ошибка Firestore:', firestoreError);
            firestoreConnected = false;
        }
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                status: firestoreConnected ? 'ok' : 'partial',
                timestamp: new Date().toISOString(),
                firebase: {
                    initialized: true,
                    appsCount: admin.apps.length,
                    projectId: serviceAccountData.project_id
                },
                firestore: {
                    connected: firestoreConnected
                },
                stats: stats,
                recentTracks: recentTracks,
                environment: {
                    hasServiceAccount: hasServiceAccount,
                    clientEmail: serviceAccountData.client_email,
                    netlifyFunction: true,
                    nodeVersion: process.version
                },
                version: '2.0.0'
            })
        };
        
    } catch (error) {
        console.error('❌ Общая ошибка:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({
                status: 'error',
                message: 'System error',
                error: error.message,
                timestamp: new Date().toISOString()
            })
        };
    }
};
