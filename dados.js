// Kimi — fontes de dados: clima, cotações, monitor do PC, relógio mundial e modo foco.
// Sem interface gráfica: dá para testar com `gjs -m`.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.DBusConnection.prototype, 'call');

let _sessao = null;
function sessao() {
    _sessao ??= new Soup.Session({user_agent: 'Kimi/1.0', timeout: 15});
    return _sessao;
}

export function encerrar() {
    _sessao?.abort();
    _sessao = null;
}

async function buscarJSON(url) {
    const msg = Soup.Message.new('GET', url);
    const bytes = await sessao().send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
    if (msg.get_status() !== Soup.Status.OK)
        throw new Error(`HTTP ${msg.get_status()}`);
    return JSON.parse(new TextDecoder().decode(bytes.get_data()));
}

// ================= formatação =================
export const real = n => Number(n).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
export const numero = (n, casas = 1) => Number(n).toLocaleString('pt-BR', {minimumFractionDigits: casas, maximumFractionDigits: casas});

// ================= clima (Open-Meteo) =================
const SP = {lat: -23.55, lon: -46.63, nome: 'São Paulo'};

const CODIGOS = [
    // [códigos WMO, descrição, ícone dia, ícone noite]
    [[0], 'Céu limpo', 'weather-clear-symbolic', 'weather-clear-night-symbolic'],
    [[1], 'Poucas nuvens', 'weather-few-clouds-symbolic', 'weather-few-clouds-night-symbolic'],
    [[2], 'Parcialmente nublado', 'weather-few-clouds-symbolic', 'weather-few-clouds-night-symbolic'],
    [[3], 'Nublado', 'weather-overcast-symbolic', 'weather-overcast-symbolic'],
    [[45, 48], 'Neblina', 'weather-fog-symbolic', 'weather-fog-symbolic'],
    [[51, 53, 55, 56, 57], 'Garoa', 'weather-showers-scattered-symbolic', 'weather-showers-scattered-symbolic'],
    [[61, 63, 66, 80, 81], 'Chuva', 'weather-showers-symbolic', 'weather-showers-symbolic'],
    [[65, 67, 82], 'Chuva forte', 'weather-showers-symbolic', 'weather-showers-symbolic'],
    [[71, 73, 75, 77, 85, 86], 'Neve', 'weather-snow-symbolic', 'weather-snow-symbolic'],
    [[95, 96, 99], 'Tempestade', 'weather-storm-symbolic', 'weather-storm-symbolic'],
];

export function descreverTempo(codigo, ehDia = true) {
    const item = CODIGOS.find(([lista]) => lista.includes(codigo));
    if (!item)
        return {descricao: 'Tempo', icone: 'weather-overcast-symbolic'};
    return {descricao: item[1], icone: ehDia ? item[2] : item[3]};
}

export async function buscarClima() {
    const url = 'https://api.open-meteo.com/v1/forecast' +
        `?latitude=${SP.lat}&longitude=${SP.lon}` +
        '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
        '&timezone=America%2FSao_Paulo&forecast_days=5';
    const d = await buscarJSON(url);
    const c = d.current;
    const dias = d.daily.time.map((data, i) => ({
        data,
        codigo: d.daily.weather_code[i],
        max: d.daily.temperature_2m_max[i],
        min: d.daily.temperature_2m_min[i],
        chuva: d.daily.precipitation_probability_max[i],
    }));
    return {
        cidade: SP.nome,
        temperatura: c.temperature_2m,
        sensacao: c.apparent_temperature,
        umidade: c.relative_humidity_2m,
        vento: c.wind_speed_10m,
        codigo: c.weather_code,
        ehDia: c.is_day === 1,
        dias,
        atualizado: new Date(),
    };
}

// ================= cotações (AwesomeAPI) =================
export const MOEDAS = [
    {par: 'USDBRL', nome: 'Dólar', simbolo: 'US$', principal: true},
    {par: 'EURBRL', nome: 'Euro', simbolo: '€'},
    {par: 'BTCBRL', nome: 'Bitcoin', simbolo: '₿'},
];

export async function buscarCotacoes() {
    const d = await buscarJSON('https://economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL,BTC-BRL');
    return MOEDAS.map(m => {
        const x = d[m.par];
        return {
            ...m,
            valor: Number(x.bid),
            variacao: Number(x.pctChange),
            maxima: Number(x.high),
            minima: Number(x.low),
            quando: new Date(Number(x.timestamp) * 1000),
        };
    });
}

// ================= monitor do PC =================
function lerArquivo(caminho) {
    try {
        const [ok, c] = GLib.file_get_contents(caminho);
        return ok ? new TextDecoder().decode(c) : '';
    } catch (_e) {
        return '';
    }
}

let _cpuAnterior = null;
/** Uso de CPU em % desde a última leitura (a primeira leitura devolve null). */
export function lerCpu() {
    const linha = lerArquivo('/proc/stat').split('\n')[0];
    const v = linha.trim().split(/\s+/).slice(1).map(Number);
    const ocioso = v[3] + (v[4] || 0);
    const total = v.reduce((a, b) => a + b, 0);
    let uso = null;
    if (_cpuAnterior) {
        const dt = total - _cpuAnterior.total;
        const di = ocioso - _cpuAnterior.ocioso;
        uso = dt > 0 ? Math.max(0, Math.min(100, 100 * (1 - di / dt))) : 0;
    }
    _cpuAnterior = {total, ocioso};
    return uso;
}

export function lerMemoria() {
    const info = {};
    for (const linha of lerArquivo('/proc/meminfo').split('\n')) {
        const m = linha.match(/^(\w+):\s+(\d+)/);
        if (m)
            info[m[1]] = Number(m[2]) * 1024;
    }
    const total = info.MemTotal || 1;
    const usada = total - (info.MemAvailable || 0);
    return {total, usada, pct: 100 * usada / total};
}

function sensores() {
    const r = {};
    try {
        const pasta = Gio.File.new_for_path('/sys/class/hwmon');
        const lista = pasta.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = lista.next_file(null))) {
            const base = `/sys/class/hwmon/${info.get_name()}`;
            const nome = lerArquivo(`${base}/name`).trim();
            const t = Number(lerArquivo(`${base}/temp1_input`).trim()) / 1000;
            if (!t)
                continue;
            if (['k10temp', 'coretemp', 'zenpower'].includes(nome))
                r.cpu = t;
            else if (nome === 'nvme')
                r.ssd = t;
        }
        lista.close(null);
    } catch (_e) {
        // sem sensores
    }
    return r;
}

export function lerTemperaturas() {
    return sensores();
}

export function lerDisco(caminho = '/') {
    try {
        const info = Gio.File.new_for_path(caminho).query_filesystem_info('filesystem::size,filesystem::free', null);
        const total = info.get_attribute_uint64('filesystem::size');
        const livre = info.get_attribute_uint64('filesystem::free');
        return {total, usado: total - livre, livre, pct: 100 * (total - livre) / total};
    } catch (_e) {
        return null;
    }
}

export function lerTempoLigado() {
    const seg = Number(lerArquivo('/proc/uptime').split(' ')[0]) || 0;
    const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

const TEM_NVIDIA = GLib.find_program_in_path('nvidia-smi') !== null;

export async function lerGpu() {
    if (!TEM_NVIDIA)
        return null;
    try {
        const proc = Gio.Subprocess.new(['nvidia-smi',
            '--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total',
            '--format=csv,noheader,nounits'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        const [saida] = await proc.communicate_utf8_async(null, null);
        const [nome, temp, uso, memUsada, memTotal] = saida.trim().split('\n')[0].split(',').map(s => s.trim());
        return {
            nome: nome.replace(/^NVIDIA (GeForce )?/, ''),
            temp: Number(temp),
            uso: Number(uso),
            memUsada: Number(memUsada) * 1024 * 1024,
            memTotal: Number(memTotal) * 1024 * 1024,
        };
    } catch (_e) {
        return null;
    }
}

export const gb = bytes => `${numero(bytes / 1024 ** 3, 1)} GB`;

// ================= relógio mundial =================
export const CIDADES = [
    {nome: 'Nova York', fuso: 'America/New_York'},
    {nome: 'Londres', fuso: 'Europe/London'},
    {nome: 'Lisboa', fuso: 'Europe/Lisbon'},
    {nome: 'Tóquio', fuso: 'Asia/Tokyo'},
];

export function horaEm(fuso) {
    const tz = GLib.TimeZone.new_identifier(fuso) ?? GLib.TimeZone.new_local();
    const agora = GLib.DateTime.new_now(tz);
    const local = GLib.DateTime.new_now_local();
    const difHoras = (agora.get_utc_offset() - local.get_utc_offset()) / 3.6e9;
    // dia relativo: comparar a data no fuso com a data local
    const diaFuso = agora.format('%Y%m%d');
    const diaLocal = local.format('%Y%m%d');
    let dia = 'hoje';
    if (diaFuso > diaLocal)
        dia = 'amanhã';
    else if (diaFuso < diaLocal)
        dia = 'ontem';
    const sinal = difHoras >= 0 ? '+' : '−';
    const dif = difHoras === 0 ? 'mesmo horário' : `${sinal}${Math.abs(difHoras)}h`;
    return {hora: agora.format('%H:%M'), dia, dif};
}

// ================= modo foco =================
const NOTIF = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});

export function naoPerturbe(ativo) {
    NOTIF.set_boolean('show-banners', !ativo);
}

export function naoPerturbeAtivo() {
    return !NOTIF.get_boolean('show-banners');
}

/** Pausa todos os players de mídia (Spotify, navegador...). */
export async function pausarMidia() {
    const bus = Gio.DBus.session;
    try {
        const [nomes] = (await bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, null)).deepUnpack();
        for (const nome of nomes.filter(n => n.startsWith('org.mpris.MediaPlayer2.'))) {
            bus.call(nome, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', 'Pause',
                null, null, Gio.DBusCallFlags.NONE, -1, null).catch(() => {});
        }
    } catch (_e) {
        // sem players
    }
}
