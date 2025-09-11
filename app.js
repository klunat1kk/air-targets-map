// Конфигурация Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDqoW0Y4Uf-dsUcK6f2k2M2Z9Q6w6qZ6qQ",
    authDomain: "air-targets-map.firebaseapp.com",
    databaseURL: "https://air-targets-map-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "air-targets-map",
    storageBucket: "air-targets-map.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef123456"
};

// Инициализация Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Глобальные переменные
let map;
let user = null;
let goals = new Map();
let targetMarkers = new Map();
let targetPaths = new Map();
let isOnline = true;
let isAdmin = false;
let movementInterval;
let lastUpdateTime = Date.now();
let isAddingByClick = false;
let tempMarker = null;

// Иконки для целей
const droneIcon = L.icon({
    iconUrl: 'shahed.png',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

const rocketIcon = L.icon({
    iconUrl: 'raketa.png', 
    iconSize: [25, 25],
    iconAnchor: [12, 12]
});

// Цвета для других типов целей
const typeColors = {
    helicopter: '#38a169',
    plane: '#4299e1', 
    unknown: '#9f7aea'
};

// Инициализация карты
function initMap() {
    map = L.map('map', {
        zoomControl: false,
        attributionControl: false
    }).setView([50.45, 30.52], 6);

    // Темная тема OSM
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Добавляем контролы в нужные позиции
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.attribution({ position: 'bottomright' }).addTo(map);

    // Обработчик клика по карте для добавления целей
    map.on('click', function(e) {
        if (isAddingByClick) {
            addTargetByClick(e.latlng);
        }
    });

    // Загрузка данных
    loadFromLocalStorage();
    initFirebase();
    startMovementInterval();
    updateStats();
    updateUI();
    setupEventListeners();
}

// Настройка обработчиков событий
function setupEventListeners() {
    // Кнопка добавления кликом
    document.getElementById('add-by-click-toggle').addEventListener('click', toggleAddByClick);
    document.getElementById('add-by-click-btn').addEventListener('click', toggleAddByClick);
}

// Инициализация Firebase
function initFirebase() {
    const goalsRef = database.ref('goals');
    
    goalsRef.on('value', (snapshot) => {
        if (!snapshot.exists()) return;
        
        const firebaseGoals = snapshot.val();
        const currentTime = Date.now();
        
        // Обновляем локальные цели данными из Firebase
        Object.entries(firebaseGoals).forEach(([id, target]) => {
            if (!goals.has(id) || target._lastUpdated > (goals.get(id)._lastUpdated || 0)) {
                goals.set(id, {
                    ...target,
                    id: id,
                    path: goals.get(id)?.path || [] // Сохраняем существующий путь
                });
                updateTargetOnMap(id);
            }
        });
        
        // Удаляем цели, которых нет в Firebase
        goals.forEach((target, id) => {
            if (!firebaseGoals[id] && target._updatedBy !== (user?.uid || 'local')) {
                deleteTarget(id, false);
            }
        });
        
        updateTargetsList();
        updateStats();
        saveToLocalStorage();
        updateLastUpdateTime();
    });

    // Слушатель изменения статуса подключения
    const connectedRef = database.ref(".info/connected");
    connectedRef.on("value", (snap) => {
        isOnline = snap.val() === true;
        updateConnectionStatus();
    });
}

// Обновление статуса подключения
function updateConnectionStatus() {
    const statusElem = document.getElementById('connection-status');
    if (isOnline) {
        statusElem.className = 'status-indicator online';
        statusElem.innerHTML = '<i class="fas fa-circle"></i> Онлайн';
    } else {
        statusElem.className = 'status-indicator offline';
        statusElem.innerHTML = '<i class="fas fa-circle"></i> Офлайн';
    }
}

// Обновление времени последнего обновления
function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('uk-UA');
    document.getElementById('last-update').textContent = `Оновлено: ${timeString}`;
    lastUpdateTime = Date.now();
}

// Переключение режима добавления кликом
function toggleAddByClick() {
    isAddingByClick = !isAddingByClick;
    const btn = document.getElementById('add-by-click-btn');
    const toggleBtn = document.getElementById('add-by-click-toggle');
    
    if (isAddingByClick) {
        btn.classList.add('active');
        toggleBtn.classList.add('active');
        toggleBtn.innerHTML = '<i class="fas fa-times"></i> Скасувати';
        map.getContainer().style.cursor = 'crosshair';
    } else {
        btn.classList.remove('active');
        toggleBtn.classList.remove('active');
        toggleBtn.innerHTML = '<i class="fas fa-mouse-pointer"></i> Додати кліком';
        map.getContainer().style.cursor = '';
        
        if (tempMarker) {
            map.removeLayer(tempMarker);
            tempMarker = null;
        }
    }
}

// Добавление цели кликом по карте
function addTargetByClick(latlng) {
    if (!isAddingByClick) return;
    
    // Показываем временный маркер
    if (tempMarker) {
        map.removeLayer(tempMarker);
    }
    
    tempMarker = L.marker(latlng, {
        icon: L.divIcon({
            className: 'temp-marker',
            html: '<div style="background: #4299e1; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white;"></div>',
            iconSize: [16, 16],
            iconAnchor: [8, 8]
        })
    }).addTo(map);
    
    // Заполняем форму координатами
    document.getElementById('target-lat').value = latlng.lat.toFixed(6);
    document.getElementById('target-lng').value = latlng.lng.toFixed(6);
    
    // Переходим на вкладку добавления
    openTab('add-tab');
    
    // Фокусируемся на поле названия
    document.getElementById('target-name').focus();
}

// Добавление цели с формы
function addTargetFromForm() {
    const name = document.getElementById('target-name').value;
    const type = document.getElementById('target-type').value;
    const lat = parseFloat(document.getElementById('target-lat').value);
    const lng = parseFloat(document.getElementById('target-lng').value);
    const course = parseInt(document.getElementById('target-course').value);
    const speed = parseInt(document.getElementById('target-speed').value);

    if (!name || isNaN(lat) || isNaN(lng) || isNaN(course) || isNaN(speed)) {
        alert('Будь ласка, заповніть всі поля коректно!');
        return;
    }

    const targetData = {
        name,
        type,
        lat,
        lng,
        course: course % 360,
        speed,
        path: [[lat, lng]],
        _lastUpdated: Date.now(),
        _updatedBy: user?.uid || 'local'
    };

    addOrUpdateTarget(targetData);
    
    // Очистка формы и выход из режима добавления
    document.getElementById('target-name').value = '';
    document.getElementById('target-lat').value = '';
    document.getElementById('target-lng').value = '';
    document.getElementById('target-course').value = '';
    document.getElementById('target-speed').value = '';
    
    if (isAddingByClick) {
        toggleAddByClick();
    }
}

// Добавление или обновление цели
function addOrUpdateTarget(targetData, targetId = null) {
    const id = targetId || generateId();
    const target = {
        ...targetData,
        id: id,
        path: targetData.path || []
    };

    goals.set(id, target);
    updateTargetOnMap(id);
    updateTargetsList();
    updateStats();
    
    // Синхронизация с Firebase
    if (isOnline) {
        const { path, ...targetForFirebase } = target;
        database.ref('goals/' + id).set(targetForFirebase)
            .catch(error => {
                console.error('Помилка синхронізації з Firebase:', error);
                saveToLocalStorage();
            });
    } else {
        saveToLocalStorage();
    }
}

// Генерация ID
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Обновление цели на карте
function updateTargetOnMap(targetId) {
    const target = goals.get(targetId);
    if (!target) return;

    // Обновляем или создаем маркер
    if (!targetMarkers.has(targetId)) {
        let marker;
        
        if (target.type === 'drone') {
            marker = L.marker([target.lat, target.lng], { icon: droneIcon });
        } else if (target.type === 'rocket') {
            marker = L.marker([target.lat, target.lng], { icon: rocketIcon });
        } else {
            marker = L.circleMarker([target.lat, target.lng], {
                radius: 6,
                fillColor: typeColors[target.type] || '#e53e3e',
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            });
        }
        
        marker.addTo(map);
        marker.on('click', () => showTargetActions(target));
        targetMarkers.set(targetId, marker);
    } else {
        const marker = targetMarkers.get(targetId);
        marker.setLatLng([target.lat, target.lng]);
        
        // Поворачиваем иконку по курсу
        if (target.type === 'drone' || target.type === 'rocket') {
            marker.setRotationAngle(target.course);
        }
    }

    // Обновляем траекторию
    updateTargetPath(targetId);
}

// Обновление траектории цели
function updateTargetPath(targetId) {
    const target = goals.get(targetId);
    if (!target.path || target.path.length < 2) return;

    if (!targetPaths.has(targetId)) {
        const polyline = L.polyline(target.path, {
            color: getTargetColor(target.type),
            weight: 2,
            opacity: 0.7,
            smoothFactor: 1
        }).addTo(map);
        targetPaths.set(targetId, polyline);
    } else {
        const polyline = targetPaths.get(targetId);
        polyline.setLatLngs(target.path);
    }
}

// Получение цвета для типа цели
function getTargetColor(type) {
    const colors = {
        drone: '#e53e3e',
        rocket: '#ed8936',
        helicopter: '#38a169',
        plane: '#4299e1',
        unknown: '#9f7aea'
    };
    return colors[type] || '#ffffff';
}

// Показ действий с целью
function showTargetActions(target) {
    if (!isAdmin) return;

    const newCourse = prompt('Введіть новий курс (0-360):', target.course);
    if (newCourse === null) return;

    const courseValue = parseInt(newCourse) % 360;
    if (isNaN(courseValue)) {
        alert('Некоректне значення курсу!');
        return;
    }

    // Обновляем цель
    const updatedTarget = {
        ...target,
        course: courseValue,
        _lastUpdated: Date.now(),
        _updatedBy: user?.uid || 'local'
    };
    
    goals.set(target.id, updatedTarget);
    
    // Обновляем маркер
    const marker = targetMarkers.get(target.id);
    if (marker && (target.type === 'drone' || target.type === 'rocket')) {
        marker.setRotationAngle(courseValue);
    }
    
    // Синхронизируем
    if (isOnline) {
        const { path, ...targetForFirebase } = updatedTarget;
        database.ref('goals/' + target.id).update(targetForFirebase);
    } else {
        saveToLocalStorage();
    }
    
    updateTargetsList();
}

// Запуск интервала движения
function startMovementInterval() {
    clearInterval(movementInterval);
    movementInterval = setInterval(moveTargets, 1000);
}

// Движение целей
function moveTargets() {
    const now = Date.now();
    const deltaTime = (now - lastUpdateTime) / 1000; // Время в секундах
    lastUpdateTime = now;

    let needsUpdate = false;

    goals.forEach((target, id) => {
        if (target.speed > 0) {
            const distance = (target.speed * deltaTime) / 3600; // Расстояние в градусах (примерно)
            const bearing = (target.course * Math.PI) / 180;
            
            const latRad = (target.lat * Math.PI) / 180;
            const newLat = target.lat + (distance * Math.cos(bearing) * 180 / Math.PI);
            const newLng = target.lng + (distance * Math.sin(bearing) * 180 / Math.PI) / Math.cos(latRad);
            
            // Обновляем позицию
            goals.set(id, {
                ...target,
                lat: newLat,
                lng: newLng,
                path: [...target.path, [newLat, newLng]].slice(-100) // Ограничиваем длину пути
            });
            
            updateTargetOnMap(id);
            needsUpdate = true;
        }
    });

    if (needsUpdate) {
        updateTargetsList();
        updateStats();
        saveToLocalStorage();
    }
}

// Обновление списка целей
function updateTargetsList() {
    const container = document.getElementById('targets-list');
    if (!container) return;

    const searchTerm = document.getElementById('target-search')?.value.toLowerCase() || '';
    
    const filteredTargets = Array.from(goals.values()).filter(target =>
        target.name.toLowerCase().includes(searchTerm) ||
        target.type.toLowerCase().includes(searchTerm)
    );

    container.innerHTML = filteredTargets.map(target => `
        <div class="target-item" onclick="showTargetActions(${JSON.stringify(target).replace(/"/g, '&quot;')})">
            <div class="target-header">
                <span class="target-name">${target.name}</span>
                <span class="target-type">${getTypeName(target.type)}</span>
            </div>
            <div class="target-coords">
                ${target.lat.toFixed(4)}, ${target.lng.toFixed(4)}
            </div>
            <div class="target-info">
                Курс: ${target.course}°, Швидкість: ${target.speed} км/год
            </div>
        </div>
    `).join('');
}

// Получение имени типа
function getTypeName(type) {
    const names = {
        drone: 'Дрон',
        rocket: 'Ракета',
        helicopter: 'Гелікоптер',
        plane: 'Літак',
        unknown: 'Невідомо'
    };
    return names[type] || type;
}

// Обновление статистики
function updateStats() {
    const stats = {
        total: goals.size,
        drones: 0,
        rockets: 0,
        moving: 0
    };

    goals.forEach(target => {
        if (target.type === 'drone') stats.drones++;
        if (target.type === 'rocket') stats.rockets++;
        if (target.speed > 0) stats.moving++;
    });

    document.getElementById('stat-total').textContent = stats.total;
    document.getElementById('stat-drones').textContent = stats.drones;
    document.getElementById('stat-rockets').textContent = stats.rockets;
    document.getElementById('stat-moving').textContent = stats.moving;
    document.getElementById('targets-count').textContent = `Цілей: ${stats.total}`;
}

// Авторизация
function login() {
    const login = document.getElementById('login').value;
    const password = document.getElementById('password').value;

    if (login === 'admin123450' && password === 'password123450') {
        user = { uid: 'admin', login: login };
        isAdmin = true;
        localStorage.setItem('userAuthenticated', 'true');
        updateUI();
        alert('Успішний вхід!');
    } else {
        alert('Невірний логін або пароль!');
    }
}

// Выход
function logout() {
    user = null;
    isAdmin = false;
    localStorage.removeItem('userAuthenticated');
    updateUI();
}

// Обновление интерфейса
function updateUI() {
    const userStatus = document.getElementById('user-status');
    const loginSection = document.getElementById('login-section');
    const adminSection = document.getElementById('admin-section');

    if (isAdmin) {
        userStatus.className = 'user-admin';
        userStatus.innerHTML = '<i class="fas fa-user-shield"></i> Адмін';
        loginSection.style.display = 'none';
        adminSection.style.display = 'block';
    } else {
        userStatus.className = 'user-guest';
        userStatus.innerHTML = '<i class="fas fa-user"></i> Гість';
        loginSection.style.display = 'block';
        adminSection.style.display = 'none';
    }
}

// Экспорт данных
function exportData() {
    const data = {
        goals: Array.from(goals.values()),
        exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `air-targets-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Импорт данных
function importData() {
    const fileInput = document.getElementById('import-file');
    fileInput.onchange = function(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                if (data.goals && Array.isArray(data.goals)) {
                    if (confirm(`Знайдено ${data.goals.length} цілей. Імпортувати?`)) {
                        data.goals.forEach(target => {
                            addOrUpdateTarget(target, target.id);
                        });
                        alert('Дані успішно імпортовано!');
                    }
                } else {
                    throw new Error('Invalid format');
                }
            } catch (error) {
                alert('Помилка при читанні файлу: некоректний формат JSON');
            }
        };
        reader.readAsText(file);
    };
    fileInput.click();
}

// Очистка всех данных
function clearAllData() {
    if (confirm('Ви впевнені, що хочете видалити ВСІ цілі? Цю дію не можна скасувати!')) {
        goals.clear();
        targetMarkers.forEach(marker => map.removeLayer(marker));
        targetPaths.forEach(path => map.removeLayer(path));
        targetMarkers.clear();
        targetPaths.clear();
        
        if (isOnline) {
            database.ref('goals').remove();
        }
        
        localStorage.removeItem('airTargetsData');
        updateTargetsList();
        updateStats();
    }
}

// Переключение панели
function togglePanel() {
    const panel = document.querySelector('.control-panel');
    const content = document.querySelector('.panel-content');
    const toggleBtn = document.querySelector('.panel-toggle i');
    
    if (content.style.height === '0px' || !content.style.height) {
        content.style.height = '300px';
        toggleBtn.className = 'fas fa-chevron-down';
        map.invalidateSize();
    } else {
        content.style.height = '0px';
        toggleBtn.className = 'fas fa-chevron-up';
        map.invalidateSize();
    }
}

// Переключение вкладок
function openTab(tabName) {
    document.querySelectorAll('.tab-pane').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    document.getElementById(tabName).classList.add('active');
    event.currentTarget.classList.add('active');
}

// Переключение траекторий
function toggleTrails() {
    const showTrails = document.getElementById('show-trails').checked;
    targetPaths.forEach(path => {
        if (showTrails) {
            map.addLayer(path);
        } else {
            map.removeLayer(path);
        }
    });
}

// Сохранение в LocalStorage
function saveToLocalStorage() {
    const data = {
        goals: Array.from(goals.values()),
        savedAt: Date.now()
    };
    localStorage.setItem('airTargetsData', JSON.stringify(data));
}

// Загрузка из LocalStorage
function loadFromLocalStorage() {
    const saved = localStorage.getItem('airTargetsData');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if (data.goals && Array.isArray(data.goals)) {
                data.goals.forEach(target => {
                    goals.set(target.id, target);
                    updateTargetOnMap(target.id);
                });
                updateTargetsList();
                updateStats();
            }
        } catch (error) {
            console.error('Помилка завантаження з LocalStorage:', error);
        }
    }
}

// Автосохранение каждые 5 секунд
setInterval(saveToLocalStorage, 5000);

// Проверка авторизации при загрузке
if (localStorage.getItem('userAuthenticated') === 'true') {
    user = { uid: 'admin', login: 'admin123450' };
    isAdmin = true;
}

// Инициализация при загрузке страницы
window.onload = function() {
    initMap();
    updateUI();
    updateConnectionStatus();
    
    // Поиск по целям
    const searchInput = document.getElementById('target-search');
    if (searchInput) {
        searchInput.addEventListener('input', updateTargetsList);
    }
};

// Глобальные функции для HTML
window.addTargetFromForm = addTargetFromForm;
window.login = login;
window.logout = logout;
window.exportData = exportData;
window.importData = importData;
window.clearAllData = clearAllData;
window.togglePanel = togglePanel;
window.openTab = openTab;
window.toggleTrails = toggleTrails;
window.showTargetActions = showTargetActions;
window.toggleAddByClick = toggleAddByClick;
