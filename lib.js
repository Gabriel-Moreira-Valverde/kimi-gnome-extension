// Kimi — funções puras: datas, feriados do Brasil e armazenamento da agenda.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const DIAS_CURTOS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
export const DIAS_LONGOS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
    'Quinta-feira', 'Sexta-feira', 'Sábado'];

const pad = n => String(n).padStart(2, '0');

/** Chave de dia no formato AAAA-MM-DD (mes começa em 0). */
export function chave(ano, mes, dia) {
    return `${ano}-${pad(mes + 1)}-${pad(dia)}`;
}

export function chaveDeData(d) {
    return chave(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Domingo de Páscoa (algoritmo gregoriano anônimo). */
export function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(ano, mes - 1, dia);
}

const cacheFeriados = new Map();

/** Feriados nacionais do Brasil: { 'AAAA-MM-DD': [{nome, facultativo}] } */
export function feriados(ano) {
    if (cacheFeriados.has(ano))
        return cacheFeriados.get(ano);
    const lista = {};
    const add = (data, nome, facultativo = false) => {
        const k = chaveDeData(data);
        (lista[k] ??= []).push({nome, facultativo});
    };
    const fixos = [
        [1, 1, 'Confraternização Universal'],
        [4, 21, 'Tiradentes'],
        [5, 1, 'Dia do Trabalho'],
        [9, 7, 'Independência do Brasil'],
        [10, 12, 'Nossa Senhora Aparecida'],
        [11, 2, 'Finados'],
        [11, 15, 'Proclamação da República'],
        [11, 20, 'Dia da Consciência Negra'],
        [12, 25, 'Natal'],
    ];
    for (const [m, d, nome] of fixos)
        add(new Date(ano, m - 1, d), nome);

    // São Paulo: estado e capital
    add(new Date(ano, 0, 25), 'Aniversário de São Paulo (cidade)');
    add(new Date(ano, 6, 9), 'Revolução Constitucionalista (estado de SP)');

    const p = pascoa(ano);
    const desloc = n => new Date(ano, p.getMonth(), p.getDate() + n);
    add(desloc(-48), 'Carnaval', true);
    add(desloc(-47), 'Carnaval', true);
    add(desloc(-46), 'Quarta-feira de Cinzas', true);
    add(desloc(-2), 'Sexta-feira Santa');
    add(p, 'Páscoa');
    add(desloc(60), 'Corpus Christi (feriado na cidade de SP)');

    cacheFeriados.set(ano, lista);
    return lista;
}

export function feriadosDoDia(k) {
    return feriados(Number(k.slice(0, 4)))[k] ?? [];
}

export const HORA_VALIDA = /^([01]?\d|2[0-3]):[0-5]\d$/;

export function normalizarHora(h) {
    h = h.trim().toLowerCase();
    if (/^\d{1,2}h$/.test(h))
        h = h.slice(0, -1);
    h = h.replace(/[h.]/, ':');
    if (/^\d{1,2}$/.test(h))
        h = `${h}:00`;
    if (!HORA_VALIDA.test(h))
        return null;
    const [hh, mm] = h.split(':');
    return `${pad(Number(hh))}:${mm}`;
}

// ---------- armazenamento: tudo fica em ~/Documentos/Kimi ----------
export function pastaKimi() {
    const docs = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Documentos']);
    return GLib.build_filenamev([docs, 'Kimi']);
}

export function pastaNotas() {
    return GLib.build_filenamev([pastaKimi(), 'Notas']);
}

function arquivoAgenda() {
    return GLib.build_filenamev([pastaKimi(), 'agenda.json']);
}

export function carregarAgenda() {
    try {
        const [ok, conteudo] = GLib.file_get_contents(arquivoAgenda());
        if (ok) {
            const dados = JSON.parse(new TextDecoder().decode(conteudo));
            if (Array.isArray(dados))
                return dados;
        }
    } catch (_e) {
        // arquivo ainda não existe ou está vazio
    }
    return [];
}

export function salvarAgenda(eventos) {
    GLib.mkdir_with_parents(pastaKimi(), 0o755);
    GLib.file_set_contents(arquivoAgenda(), JSON.stringify(eventos, null, 2));
}

// ---------- notas: um arquivo .txt por nota ----------
export function nomeSeguro(titulo) {
    const t = titulo.replace(/[\/\\:*?"<>|\n\r\t]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
    return t || 'Sem título';
}

export function listarNotas() {
    const notas = [];
    try {
        const pasta = Gio.File.new_for_path(pastaNotas());
        const lista = pasta.enumerate_children('standard::name,standard::type,time::modified',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = lista.next_file(null))) {
            const nome = info.get_name();
            if (info.get_file_type() !== Gio.FileType.REGULAR || !nome.endsWith('.txt'))
                continue;
            notas.push({
                titulo: nome.slice(0, -4),
                caminho: GLib.build_filenamev([pastaNotas(), nome]),
                modificado: info.get_attribute_uint64('time::modified'),
            });
        }
        lista.close(null);
    } catch (_e) {
        // pasta ainda não existe
    }
    return notas.sort((a, b) => b.modificado - a.modificado);
}

export function lerNota(caminho) {
    try {
        const [ok, conteudo] = GLib.file_get_contents(caminho);
        return ok ? new TextDecoder().decode(conteudo) : '';
    } catch (_e) {
        return '';
    }
}

function caminhoLivre(titulo, atual) {
    const base = nomeSeguro(titulo);
    let caminho = GLib.build_filenamev([pastaNotas(), `${base}.txt`]);
    let n = 2;
    while (caminho !== atual && GLib.file_test(caminho, GLib.FileTest.EXISTS))
        caminho = GLib.build_filenamev([pastaNotas(), `${base} (${n++}).txt`]);
    return caminho;
}

/** Salva a nota; se o título mudou, renomeia o arquivo. Devolve o caminho final. */
export function salvarNota(atual, titulo, texto) {
    GLib.mkdir_with_parents(pastaNotas(), 0o755);
    const destino = caminhoLivre(titulo, atual);
    GLib.file_set_contents(destino, texto);
    if (atual && atual !== destino && GLib.file_test(atual, GLib.FileTest.EXISTS))
        Gio.File.new_for_path(atual).delete(null);
    return destino;
}

/** Manda a nota para a lixeira (dá para recuperar). */
export function excluirNota(caminho) {
    const arquivo = Gio.File.new_for_path(caminho);
    try {
        arquivo.trash(null);
    } catch (_e) {
        arquivo.delete(null);
    }
}

/** Ordena por dia e depois por hora (dia todo primeiro). */
export function ordenar(eventos) {
    return eventos.sort((a, b) =>
        a.data.localeCompare(b.data) || (a.hora || '').localeCompare(b.hora || ''));
}
