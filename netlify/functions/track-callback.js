const admin = require('firebase-admin');

// Простая инициализация Firebase
function initializeFirebase() {
    // Проверяем, не инициализирован ли уже Firebase
    if (admin.apps.length > 0) {
        console.log('✅ Firebase уже инициализирован');
        return true;
    }
    
    try {
        console.log('🔄 Инициализация Firebase...');
        
        // Получаем переменные окружения
        const privateKey = process.env.FIREBASE_PRIVATE_KEY;
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
        const projectId = "pulse-fm-84a48";
        
        console.log('📋 Проверка данных:');
        console.log('- Project ID:', projectId);
        console.log('- Client Email:', clientEmail);
        console.log('- Private Key длина:', privateKey ? privateKey.length : 0);
        console.log('- Private Key начинается с:', privateKey ? privateKey.substring(0, 30) : 'null');
        
        if (!privateKey || !clientEmail) {
            throw new Error('Отсутствуют обязательные переменные окружения');
        }
        
        // Простая обработка приватного ключа
        let cleanPrivateKey = privateKey;
        
        // Если это строка из environment variable, очищаем её
        if (typeof cleanPrivateKey === 'string') {
            // Заменяем \\n на настоящие переносы строк
            cleanPrivateKey = cleanPrivateKey.replace(/\\n/g, '\n');
            
            // Убираем лишние кавычки если есть
            cleanPrivateKey = cleanPrivateKey.replace(/^"/, '').replace(/"$/, '');
        }
        
        console.log('🔑 Обработанный ключ начинается с:', cleanPrivateKey.substring(0, 30));
        console.log('🔑 Обработанный ключ заканчивается на:', cleanPrivateKey.substring(cleanPrivateKey.length - 30));
        
        // Конфигурация Firebase
        const serviceAccount = {
            type: "service_account",
            project_id: projectId,
            private_key_id: "dummy", // Не обязательно для работы
            private_key: cleanPrivateKey,
            client_email: clientEmail,
            client_id: "dummy", // Не обязательно для работы
            auth_uri: "https://accounts.google.com/o/oauth2/auth",
            token_uri: "https://oauth2.googleapis.com/token",
            auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs"
        };
        
        // Инициализируем Firebase Admin
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: projectId
        });
        
        console.log('✅ Firebase успешно инициализирован');
        return true;
        
    } catch (error) {
        console.error('❌ Полная ошибка Firebase:', error);
        console.error('❌ Стек ошибки:', error.stack);
        return false;
    }
}

// Функция для тестирования подключения к Firestore
async function testFirestoreConnection() {
    try {
        console.log('🧪 Тестирование подключения к Firestore...');
        
        const db = admin.firestore();
        
        // Простой тест - получение коллекции
        const testCollection = await db.collection('test').limit(1).get();
        console.log('✅ Firestore подключение работает');
        
        return true;
    } catch (error) {
        console.error('❌ Ошибка подключения к Firestore:', error);
        return false;
    }
}

// Экспортируем функции
module.exports = {
    initializeFirebase,
    testFirestoreConnection
};
