// Kimi — relógio, calendário, clima, cotações, monitor, foco e notas, no centro da barra superior.
// Tudo que o Kimi cria fica em ~/Documentos/Kimi.
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as L from './lib.js';
import * as D from './dados.js';

const VERTICAL = Clutter.Orientation.VERTICAL;
const CENTRO = Clutter.ActorAlign.CENTER;
const AVISO_DIA_TODO = '08:00';   // compromissos sem hora avisam às 8h
const JANELA_AVISO_MIN = 10;      // avisa até 10 min depois do horário

// Seções da barra lateral. Para criar uma seção nova, basta adicionar aqui.
const SECOES = [
    {id: 'relogio', nome: 'Relógio', icone: 'preferences-system-time-symbolic'},
    {id: 'calendario', nome: 'Calendário', icone: 'x-office-calendar-symbolic'},
    {id: 'clima', nome: 'Clima', icone: 'weather-few-clouds-symbolic'},
    {id: 'cotacoes', nome: 'Cotações', icone: 'money-symbolic'},
    {id: 'monitor', nome: 'Monitor', icone: 'utilities-system-monitor-symbolic'},
    {id: 'foco', nome: 'Modo foco', icone: 'notifications-disabled-symbolic'},
    {id: 'notas', nome: 'Notas', icone: 'accessories-text-editor-symbolic'},
];
const SECAO_PRINCIPAL = 'relogio';
const FOCO_OPCOES = [[25, '25 min'], [50, '50 min'], [90, '1h30'], [0, 'Sem limite']];
const BARRA_LARGURA = 260;

const KimiButton = GObject.registerClass(
class KimiButton extends PanelMenu.Button {
    _init(caminho) {
        super._init(0.5, 'Kimi', false);

        const caixa = new St.BoxLayout({style_class: 'kimi-panel-box'});
        caixa.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(`${caminho}/icons/kimi-robo-symbolic.svg`),
            style_class: 'system-status-icon kimi-robo',
        }));
        this._rotuloPainel = new St.Label({text: 'Kimi', y_align: CENTRO, style_class: 'kimi-panel-label'});
        caixa.add_child(this._rotuloPainel);
        this.add_child(caixa);

        this._eventos = L.carregarAgenda();
        this._irParaHoje();
        this._notaAtual = null;   // caminho do arquivo da nota aberta (null = nova)

        // corpo: barra lateral à esquerda + página da seção à direita
        this._corpo = new St.BoxLayout({style_class: 'kimi-body'});
        this.menu.box.add_child(this._corpo);

        this._lateral = new St.BoxLayout({orientation: VERTICAL, style_class: 'kimi-sidebar'});
        this._corpo.add_child(this._lateral);

        this._clima = null;
        this._cotacoes = null;
        this._focoFim = null;     // null = desligado; 0 = sem limite; ms = horário de término
        this._paginas = new Map();
        this._paginas.set('relogio', this._construirRelogio());
        this._paginas.set('clima', this._construirClima());
        this._paginas.set('cotacoes', this._construirCotacoes());
        this._paginas.set('monitor', this._construirMonitor());
        this._paginas.set('foco', this._construirFoco());
        this._paginas.set('calendario', this._construirCalendario());
        this._paginas.set('notas', this._construirNotas());
        this._paginas.set('embreve', this._construirEmBreve());
        for (const pagina of this._paginas.values())
            this._corpo.add_child(pagina);

        this._construirLateral();
        this._mostrarSecao(SECAO_PRINCIPAL);
        this._desenharCalendario();

        this.menu.connect('open-state-changed', (_m, aberto) => {
            if (aberto) {
                this._irParaHoje();
                this._desenharCalendario();
                this._mostrarSecao(SECAO_PRINCIPAL);
                this._iniciarTique();
            } else {
                this._pararTique();
                this._salvarNotaSeMudou();
            }
        });

        this._verificarLembretes(true);
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
            this._verificarLembretes(false);
            return GLib.SOURCE_CONTINUE;
        });
    }

    // ================= utilidades =================
    _botaoIcone(icone, classe, aoClicar) {
        const b = new St.Button({
            style_class: classe,
            can_focus: true,
            child: new St.Icon({icon_name: icone, icon_size: 16}),
        });
        b.connect('clicked', aoClicar);
        return b;
    }

    _botaoTexto(icone, texto, classe, aoClicar) {
        const conteudo = new St.BoxLayout({style_class: 'kimi-btn-conteudo'});
        conteudo.add_child(new St.Icon({icon_name: icone, icon_size: 14}));
        conteudo.add_child(new St.Label({text: texto, y_align: CENTRO}));
        const b = new St.Button({style_class: classe, child: conteudo, can_focus: true});
        b.connect('clicked', aoClicar);
        return b;
    }

    _coluna(classe) {
        return new St.BoxLayout({orientation: VERTICAL, style_class: classe});
    }

    _rolagem(conteudo, classe) {
        const sv = new St.ScrollView({
            style_class: classe,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        sv.child = conteudo;
        return sv;
    }

    _abrirPasta(caminho) {
        GLib.mkdir_with_parents(caminho, 0o755);
        this.menu.close();
        Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(caminho, null), null);
    }

    // ================= barra lateral =================
    _construirLateral() {
        this._botoesSecao = new Map();
        for (const secao of SECOES) {
            const conteudo = new St.BoxLayout({style_class: 'kimi-side-conteudo'});
            conteudo.add_child(new St.Icon({icon_name: secao.icone, icon_size: 16}));
            conteudo.add_child(new St.Label({text: secao.nome, y_align: CENTRO}));
            const botao = new St.Button({style_class: 'kimi-side-btn', child: conteudo, can_focus: true, x_expand: true});
            botao.connect('clicked', () => this._mostrarSecao(secao.id));
            this._lateral.add_child(botao);
            this._botoesSecao.set(secao.id, botao);
        }
        this._lateral.add_child(new St.Widget({y_expand: true}));
        this._lateral.add_child(this._botaoTexto('folder-documents-symbolic', 'Abrir pasta', 'kimi-side-btn kimi-side-pasta',
            () => this._abrirPasta(L.pastaKimi())));
    }

    _mostrarSecao(id) {
        if (this._secao === 'notas' && id !== 'notas')
            this._salvarNotaSeMudou();
        this._secao = id;
        for (const [sid, botao] of this._botoesSecao) {
            if (sid === id)
                botao.add_style_class_name('kimi-side-ativo');
            else
                botao.remove_style_class_name('kimi-side-ativo');
        }
        const pagina = this._paginas.has(id) ? id : 'embreve';
        for (const [pid, ator] of this._paginas)
            ator.visible = pid === pagina;
        if (pagina === 'embreve') {
            const secao = SECOES.find(x => x.id === id);
            this._embreveIcone.icon_name = secao.icone;
            this._embreveTitulo.text = secao.nome;
        }
        this._aoEntrar(pagina);
    }

    _aoEntrar(pagina) {
        switch (pagina) {
        case 'notas':
            this._desenharListaNotas();
            break;
        case 'relogio':
            this._atualizarRelogio();
            break;
        case 'clima':
            this._desenharClima();
            if (!this._clima || Date.now() - this._clima.atualizado > 10 * 60000)
                this._carregarClima();
            break;
        case 'cotacoes':
            this._desenharCotacoes();
            if (!this._cotacoes || Date.now() - this._cotacoesEm > 5 * 60000)
                this._carregarCotacoes();
            break;
        case 'monitor':
            D.lerCpu();
            this._atualizarMonitor();
            break;
        case 'foco':
            this._desenharFoco();
            break;
        }
    }

    // ================= tique de 1 segundo (só com o Kimi aberto) =================
    _iniciarTique() {
        this._pararTique();
        let n = 0;
        this._tique = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            n++;
            if (this._secao === 'relogio')
                this._atualizarRelogio();
            else if (this._secao === 'monitor' && n % 2 === 0)
                this._atualizarMonitor();
            else if (this._secao === 'foco')
                this._desenharFoco();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _pararTique() {
        if (this._tique) {
            GLib.Source.remove(this._tique);
            this._tique = null;
        }
    }

    _pagina(classe) {
        return new St.BoxLayout({orientation: VERTICAL, style_class: `kimi-page ${classe}`, x_expand: true});
    }

    _rotulo(texto, classe, extra = {}) {
        return new St.Label({text: texto, style_class: classe, ...extra});
    }

    _botaoAtualizar(aoClicar) {
        return this._botaoIcone('view-refresh-symbolic', 'kimi-nav', aoClicar);
    }

    // ================= relógio =================
    _construirRelogio() {
        const pagina = this._pagina('kimi-relogio');
        this._relHora = this._rotulo('00:00', 'kimi-rel-hora', {x_align: CENTRO});
        this._relSeg = this._rotulo('00', 'kimi-rel-seg', {y_align: Clutter.ActorAlign.END});
        const linhaHora = new St.BoxLayout({x_align: CENTRO, style_class: 'kimi-rel-linha'});
        linhaHora.add_child(this._relHora);
        linhaHora.add_child(this._relSeg);
        pagina.add_child(linhaHora);
        this._relData = this._rotulo('data', 'kimi-rel-data', {x_align: CENTRO});
        pagina.add_child(this._relData);
        pagina.add_child(this._rotulo('São Paulo · horário de Brasília', 'kimi-rel-local', {x_align: CENTRO}));

        pagina.add_child(new St.Widget({style_class: 'kimi-sep', x_expand: true}));
        pagina.add_child(this._rotulo('Relógio mundial', 'kimi-section-title'));
        const grade = new St.BoxLayout({style_class: 'kimi-cards', x_expand: true});
        this._relCidades = [];
        for (const cidade of D.CIDADES) {
            const card = new St.BoxLayout({orientation: VERTICAL, style_class: 'kimi-card', x_expand: true});
            card.add_child(this._rotulo(cidade.nome, 'kimi-card-titulo'));
            const hora = this._rotulo('--:--', 'kimi-card-hora');
            const info = this._rotulo('', 'kimi-card-info');
            info.text = '…';
            card.add_child(hora);
            card.add_child(info);
            grade.add_child(card);
            this._relCidades.push({cidade, hora, info});
        }
        pagina.add_child(grade);
        return pagina;
    }

    _atualizarRelogio() {
        const agora = GLib.DateTime.new_now_local();
        this._relHora.text = agora.format('%H:%M');
        this._relSeg.text = agora.format(':%S');
        const data = new Date().toLocaleDateString('pt-BR', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
        this._relData.text = data.charAt(0).toUpperCase() + data.slice(1);
        for (const {cidade, hora, info} of this._relCidades) {
            const h = D.horaEm(cidade.fuso);
            hora.text = h.hora;
            info.text = `${h.dia} · ${h.dif}`;
        }
    }

    // ================= clima =================
    _construirClima() {
        const pagina = this._pagina('kimi-clima');
        const cab = new St.BoxLayout({style_class: 'kimi-header'});
        cab.add_child(this._rotulo('Clima em São Paulo', 'kimi-title', {x_expand: true, y_align: CENTRO}));
        this._climaQuando = this._rotulo('…', 'kimi-mini', {y_align: CENTRO});
        cab.add_child(this._climaQuando);
        cab.add_child(this._botaoAtualizar(() => this._carregarClima()));
        pagina.add_child(cab);

        const agora = new St.BoxLayout({style_class: 'kimi-clima-agora'});
        this._climaIcone = new St.Icon({icon_name: 'weather-overcast-symbolic', icon_size: 72, style_class: 'kimi-clima-icone'});
        agora.add_child(this._climaIcone);
        const col = new St.BoxLayout({orientation: VERTICAL, y_align: CENTRO, style_class: 'kimi-clima-col'});
        this._climaTemp = this._rotulo('--°', 'kimi-clima-temp');
        this._climaDesc = this._rotulo('Carregando…', 'kimi-clima-desc');
        this._climaDet = this._rotulo('…', 'kimi-mini');
        col.add_child(this._climaTemp);
        col.add_child(this._climaDesc);
        col.add_child(this._climaDet);
        agora.add_child(col);
        pagina.add_child(agora);

        pagina.add_child(new St.Widget({style_class: 'kimi-sep', x_expand: true}));
        this._climaDias = new St.BoxLayout({style_class: 'kimi-cards', x_expand: true});
        pagina.add_child(this._climaDias);
        return pagina;
    }

    async _carregarClima() {
        this._climaQuando.text = 'atualizando…';
        try {
            this._clima = await D.buscarClima();
            this._climaErro = null;
        } catch (e) {
            this._climaErro = e.message;
        }
        this._desenharClima();
    }

    _desenharClima() {
        const c = this._clima;
        if (!c) {
            this._climaQuando.text = this._climaErro ? 'sem conexão' : 'carregando…';
            return;
        }
        const t = D.descreverTempo(c.codigo, c.ehDia);
        this._climaIcone.icon_name = t.icone;
        this._climaTemp.text = `${Math.round(c.temperatura)}°`;
        this._climaDesc.text = t.descricao;
        this._climaDet.text = `Sensação ${Math.round(c.sensacao)}° · Umidade ${c.umidade}% · Vento ${Math.round(c.vento)} km/h`;
        this._climaQuando.text = `às ${c.atualizado.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`;

        this._climaDias.destroy_all_children();
        c.dias.forEach((dia, i) => {
            const [a, m, d] = dia.data.split('-').map(Number);
            const nome = i === 0 ? 'Hoje' : L.DIAS_LONGOS[new Date(a, m - 1, d).getDay()].slice(0, 3);
            const card = new St.BoxLayout({orientation: VERTICAL, style_class: 'kimi-card kimi-card-dia', x_expand: true});
            card.add_child(this._rotulo(nome, 'kimi-card-titulo', {x_align: CENTRO}));
            card.add_child(new St.Icon({icon_name: D.descreverTempo(dia.codigo).icone, icon_size: 28, x_align: CENTRO, style_class: 'kimi-clima-icone'}));
            card.add_child(this._rotulo(`${Math.round(dia.max)}° / ${Math.round(dia.min)}°`, 'kimi-card-hora kimi-dia-temp', {x_align: CENTRO}));
            card.add_child(this._rotulo(`chuva ${dia.chuva ?? 0}%`, 'kimi-card-info kimi-chuva', {x_align: CENTRO}));
            this._climaDias.add_child(card);
        });
    }

    // ================= cotações =================
    _construirCotacoes() {
        const pagina = this._pagina('kimi-cotacoes');
        const cab = new St.BoxLayout({style_class: 'kimi-header'});
        cab.add_child(this._rotulo('Cotações', 'kimi-title', {x_expand: true, y_align: CENTRO}));
        this._cotQuando = this._rotulo('…', 'kimi-mini', {y_align: CENTRO});
        cab.add_child(this._cotQuando);
        cab.add_child(this._botaoAtualizar(() => this._carregarCotacoes()));
        pagina.add_child(cab);
        this._cotLista = new St.BoxLayout({orientation: VERTICAL, style_class: 'kimi-list kimi-cot-lista'});
        pagina.add_child(this._cotLista);
        pagina.add_child(this._rotulo('Fonte: AwesomeAPI · valores de compra em reais', 'kimi-mini kimi-rodape'));
        return pagina;
    }

    async _carregarCotacoes() {
        this._cotQuando.text = 'atualizando…';
        try {
            this._cotacoes = await D.buscarCotacoes();
            this._cotacoesEm = Date.now();
            this._cotErro = null;
        } catch (e) {
            this._cotErro = e.message;
        }
        this._desenharCotacoes();
    }

    _desenharCotacoes() {
        if (!this._cotacoes) {
            this._cotQuando.text = this._cotErro ? 'sem conexão' : 'carregando…';
            return;
        }
        this._cotQuando.text = `às ${new Date(this._cotacoesEm).toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'})}`;
        this._cotLista.destroy_all_children();
        for (const m of this._cotacoes) {
            const sobe = m.variacao >= 0;
            const card = new St.BoxLayout({style_class: m.principal ? 'kimi-cot kimi-cot-principal' : 'kimi-cot'});
            const esq = new St.BoxLayout({orientation: VERTICAL, x_expand: true, y_align: CENTRO});
            esq.add_child(this._rotulo(`${m.nome}  (${m.simbolo} 1)`, 'kimi-cot-nome'));
            esq.add_child(this._rotulo(D.real(m.valor), m.principal ? 'kimi-cot-valor kimi-cot-valor-grande' : 'kimi-cot-valor'));
            card.add_child(esq);
            const dir = new St.BoxLayout({orientation: VERTICAL, y_align: CENTRO});
            dir.add_child(this._rotulo(`${sobe ? '▲' : '▼'} ${D.numero(Math.abs(m.variacao), 2)}%`,
                sobe ? 'kimi-cot-var kimi-sobe' : 'kimi-cot-var kimi-desce', {x_align: Clutter.ActorAlign.END}));
            dir.add_child(this._rotulo(`máx ${D.real(m.maxima)}`, 'kimi-mini', {x_align: Clutter.ActorAlign.END}));
            dir.add_child(this._rotulo(`mín ${D.real(m.minima)}`, 'kimi-mini', {x_align: Clutter.ActorAlign.END}));
            card.add_child(dir);
            this._cotLista.add_child(card);
        }
    }

    // ================= monitor do PC =================
    _construirMonitor() {
        const pagina = this._pagina('kimi-monitor');
        const cab = new St.BoxLayout({style_class: 'kimi-header'});
        cab.add_child(this._rotulo('Monitor do PC', 'kimi-title', {x_expand: true, y_align: CENTRO}));
        this._monLigado = this._rotulo('…', 'kimi-mini', {y_align: CENTRO});
        cab.add_child(this._monLigado);
        pagina.add_child(cab);
        this._monLinhas = {};
        for (const [id, nome, icone] of [
            ['cpu', 'Processador', 'speedometer-symbolic'],
            ['mem', 'Memória', 'computer-chip-symbolic'],
            ['gpu', 'Placa de vídeo', 'video-display-symbolic'],
            ['vram', 'Memória de vídeo', 'video-display-symbolic'],
            ['disco', 'Disco (Ubuntu)', 'drive-harddisk-symbolic'],
        ]) {
            const linha = new St.BoxLayout({orientation: VERTICAL, style_class: 'kimi-mon-linha'});
            const topo = new St.BoxLayout({style_class: 'kimi-mon-topo'});
            topo.add_child(new St.Icon({icon_name: icone, icon_size: 14, style_class: 'kimi-mon-icone'}));
            topo.add_child(this._rotulo(nome, 'kimi-mon-nome', {x_expand: true}));
            const valor = this._rotulo('…', 'kimi-mon-valor');
            topo.add_child(valor);
            linha.add_child(topo);
            const barra = new St.Widget({style_class: 'kimi-barra', width: BARRA_LARGURA * 2});
            const fill = new St.Widget({style_class: 'kimi-barra-fill', width: 1, height: 6});
            barra.add_child(fill);
            linha.add_child(barra);
            pagina.add_child(linha);
            this._monLinhas[id] = {valor, fill, linha};
        }
        return pagina;
    }

    _barra(id, pct, texto) {
        const l = this._monLinhas[id];
        l.valor.text = texto;
        const p = Math.max(0, Math.min(100, pct || 0));
        l.fill.set_width(Math.max(1, Math.round(BARRA_LARGURA * 2 * p / 100)));
        l.fill.remove_style_class_name('kimi-alto');
        if (p >= 85)
            l.fill.add_style_class_name('kimi-alto');
    }

    async _atualizarMonitor() {
        const cpu = D.lerCpu();
        const temps = D.lerTemperaturas();
        const tCpu = temps.cpu ? ` · ${Math.round(temps.cpu)}°C` : '';
        this._barra('cpu', cpu ?? 0, `${cpu === null ? '…' : `${D.numero(cpu, 0)}%`}${tCpu}`);

        const mem = D.lerMemoria();
        this._barra('mem', mem.pct, `${D.gb(mem.usada)} de ${D.gb(mem.total)}`);

        const disco = D.lerDisco('/');
        const tSsd = temps.ssd ? ` · ${Math.round(temps.ssd)}°C` : '';
        if (disco)
            this._barra('disco', disco.pct, `${D.gb(disco.usado)} de ${D.gb(disco.total)}${tSsd}`);

        this._monLigado.text = `ligado há ${D.lerTempoLigado()}`;

        const gpu = await D.lerGpu();
        if (gpu) {
            this._barra('gpu', gpu.uso, `${gpu.nome} · ${gpu.uso}% · ${gpu.temp}°C`);
            this._barra('vram', 100 * gpu.memUsada / gpu.memTotal, `${D.gb(gpu.memUsada)} de ${D.gb(gpu.memTotal)}`);
        } else {
            this._monLinhas.gpu.linha.hide();
            this._monLinhas.vram.linha.hide();
        }
    }

    // ================= modo foco =================
    _construirFoco() {
        const pagina = this._pagina('kimi-foco');
        pagina.add_child(this._rotulo('Modo foco', 'kimi-title'));
        pagina.add_child(this._rotulo('Silencia as notificações e pausa a música enquanto você se concentra.', 'kimi-mini'));
        this._focoIcone = new St.Icon({icon_name: 'notifications-disabled-symbolic', icon_size: 56, x_align: CENTRO, style_class: 'kimi-foco-icone'});
        pagina.add_child(this._focoIcone);
        this._focoEstado = this._rotulo('Desligado', 'kimi-foco-estado', {x_align: CENTRO});
        pagina.add_child(this._focoEstado);
        this._focoTempo = this._rotulo('Escolha por quanto tempo:', 'kimi-mini', {x_align: CENTRO});
        pagina.add_child(this._focoTempo);

        this._focoBotoes = new St.BoxLayout({style_class: 'kimi-foco-botoes', x_align: CENTRO});
        for (const [min, texto] of FOCO_OPCOES) {
            const b = new St.Button({label: texto, style_class: 'kimi-btn kimi-foco-opcao', can_focus: true});
            b.connect('clicked', () => this._ligarFoco(min));
            this._focoBotoes.add_child(b);
        }
        pagina.add_child(this._focoBotoes);

        this._focoParar = this._botaoTexto('media-playback-stop-symbolic', 'Encerrar foco', 'kimi-btn kimi-btn-perigo kimi-foco-parar',
            () => this._desligarFoco(false));
        this._focoParar.x_align = CENTRO;
        pagina.add_child(this._focoParar);
        return pagina;
    }

    _ligarFoco(minutos) {
        this._focoFim = minutos > 0 ? Date.now() + minutos * 60000 : 0;
        D.naoPerturbe(true);
        D.pausarMidia();
        this._focoTimer ??= GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._tiqueFoco();
            return GLib.SOURCE_CONTINUE;
        });
        this._tiqueFoco();
        this._desenharFoco();
    }

    _desligarFoco(terminou) {
        if (this._focoFim === null)
            return;
        this._focoFim = null;
        D.naoPerturbe(false);
        if (this._focoTimer) {
            GLib.Source.remove(this._focoTimer);
            this._focoTimer = null;
        }
        this._rotuloPainel.text = 'Kimi';
        this.remove_style_class_name('kimi-em-foco');
        if (terminou)
            Main.notify('Kimi · Foco concluído', 'Bom trabalho! As notificações voltaram.');
        this._desenharFoco();
    }

    _restanteFoco() {
        if (!this._focoFim)
            return null;
        const s = Math.max(0, Math.round((this._focoFim - Date.now()) / 1000));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
        const mmss = `${String(m).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
        return {s, texto: h > 0 ? `${h}:${mmss}` : mmss};
    }

    _tiqueFoco() {
        if (this._focoFim === null)
            return;
        const r = this._restanteFoco();
        if (r && r.s <= 0) {
            this._desligarFoco(true);
            return;
        }
        this.add_style_class_name('kimi-em-foco');
        this._rotuloPainel.text = r ? `Foco ${r.texto}` : 'Foco';
    }

    _desenharFoco() {
        const ativo = this._focoFim !== null;
        this._focoBotoes.visible = !ativo;
        this._focoParar.visible = ativo;
        if (ativo) {
            this._focoIcone.add_style_class_name('kimi-foco-ativo');
            const r = this._restanteFoco();
            this._focoEstado.text = 'Foco ativo';
            this._focoTempo.text = r ? `${r.texto} restantes` : 'Sem limite de tempo';
        } else {
            this._focoIcone.remove_style_class_name('kimi-foco-ativo');
            this._focoEstado.text = 'Desligado';
            this._focoTempo.text = 'Escolha por quanto tempo:';
        }
    }

    // ================= página "em breve" =================
    _construirEmBreve() {
        const pagina = new St.BoxLayout({orientation: VERTICAL, style_class: 'kimi-page kimi-embreve', x_expand: true});
        this._embreveIcone = new St.Icon({icon_size: 48, style_class: 'kimi-embreve-icone', x_align: CENTRO});
        this._embreveTitulo = new St.Label({text: 'Seção', style_class: 'kimi-embreve-titulo', x_align: CENTRO});
        pagina.add_child(this._embreveIcone);
        pagina.add_child(this._embreveTitulo);
        pagina.add_child(new St.Label({text: 'Em breve. Esta seção ainda não faz nada.', style_class: 'kimi-vazio', x_align: CENTRO}));
        return pagina;
    }

    // ================= calendário =================
    _irParaHoje() {
        const h = new Date();
        this._ano = h.getFullYear();
        this._mes = h.getMonth();
        this._sel = L.chaveDeData(h);
    }

    _construirCalendario() {
        const pagina = new St.BoxLayout({style_class: 'kimi-page kimi-cal', x_expand: true});
        const esq = this._coluna('kimi-col-cal');
        const dir = this._coluna('kimi-col-info');
        pagina.add_child(esq);
        pagina.add_child(new St.Widget({style_class: 'kimi-vsep', y_expand: true}));
        pagina.add_child(dir);

        // --- esquerda: mês ---
        const cab = new St.BoxLayout({style_class: 'kimi-header'});
        this._titulo = new St.Label({text: 'Mês', style_class: 'kimi-title', x_expand: true, y_align: CENTRO});
        const hoje = new St.Button({label: 'Hoje', style_class: 'kimi-today-btn', can_focus: true});
        hoje.connect('clicked', () => {
            this._irParaHoje();
            this._desenharCalendario();
        });
        cab.add_child(this._titulo);
        cab.add_child(hoje);
        cab.add_child(this._botaoIcone('go-previous-symbolic', 'kimi-nav', () => this._mudarMes(-1)));
        cab.add_child(this._botaoIcone('go-next-symbolic', 'kimi-nav', () => this._mudarMes(1)));
        esq.add_child(cab);

        const semana = new St.BoxLayout({style_class: 'kimi-row'});
        for (const d of L.DIAS_CURTOS)
            semana.add_child(new St.Label({text: d, style_class: 'kimi-wd'}));
        esq.add_child(semana);

        this._grade = this._coluna('kimi-grid');
        esq.add_child(this._grade);

        // --- direita: dia selecionado + agendar + feriados do mês ---
        this._tituloDia = new St.Label({text: 'Dia', style_class: 'kimi-section-title'});
        dir.add_child(this._tituloDia);
        this._listaDia = this._coluna('kimi-list');
        dir.add_child(this._rolagem(this._listaDia, 'kimi-scroll-dia'));

        const form = new St.BoxLayout({style_class: 'kimi-form'});
        this._campoTitulo = new St.Entry({hint_text: 'Novo compromisso…', style_class: 'kimi-entry', can_focus: true, x_expand: true});
        this._campoHora = new St.Entry({hint_text: 'hora', style_class: 'kimi-entry kimi-hora', can_focus: true});
        for (const campo of [this._campoTitulo, this._campoHora])
            campo.clutter_text.connect('activate', () => this._adicionar());
        form.add_child(this._campoTitulo);
        form.add_child(this._campoHora);
        form.add_child(this._botaoIcone('list-add-symbolic', 'kimi-add', () => this._adicionar()));
        dir.add_child(form);

        this._erro = new St.Label({text: 'erro', style_class: 'kimi-erro', visible: false});
        dir.add_child(this._erro);

        dir.add_child(new St.Widget({style_class: 'kimi-sep', x_expand: true}));
        this._tituloMes = new St.Label({text: 'Feriados', style_class: 'kimi-section-title'});
        dir.add_child(this._tituloMes);
        this._listaMes = this._coluna('kimi-list');
        dir.add_child(this._listaMes);
        return pagina;
    }

    _mudarMes(delta) {
        this._mes += delta;
        if (this._mes < 0) {
            this._mes = 11;
            this._ano--;
        } else if (this._mes > 11) {
            this._mes = 0;
            this._ano++;
        }
        this._desenharCalendario();
    }

    _desenharCalendario() {
        this._titulo.text = `${L.MESES[this._mes]} ${this._ano}`;
        this._desenharGrade();
        this._desenharDia();
        this._desenharMes();
    }

    _desenharGrade() {
        this._grade.destroy_all_children();
        const hoje = L.chaveDeData(new Date());
        const primeiro = new Date(this._ano, this._mes, 1).getDay();
        const total = new Date(this._ano, this._mes + 1, 0).getDate();
        const comEvento = new Set(this._eventos.map(e => e.data));
        const fer = L.feriados(this._ano);

        let dia = 1 - primeiro;
        for (let linha = 0; linha < 6; linha++) {
            const row = new St.BoxLayout({style_class: 'kimi-row'});
            for (let col = 0; col < 7; col++, dia++) {
                if (dia < 1 || dia > total) {
                    row.add_child(new St.Widget({style_class: 'kimi-day kimi-out'}));
                    continue;
                }
                const k = L.chave(this._ano, this._mes, dia);
                const classes = ['kimi-day'];
                if (k === hoje)
                    classes.push('kimi-hoje');
                if (k === this._sel)
                    classes.push('kimi-sel');
                if (fer[k])
                    classes.push('kimi-feriado');
                if (col === 0)
                    classes.push('kimi-domingo');

                const conteudo = new St.BoxLayout({orientation: VERTICAL, x_expand: true});
                conteudo.add_child(new St.Label({text: String(dia), style_class: 'kimi-day-num', x_align: CENTRO}));
                conteudo.add_child(new St.Label({
                    text: '•',
                    style_class: comEvento.has(k) ? 'kimi-dot' : 'kimi-dot kimi-dot-off',
                    x_align: CENTRO,
                }));
                const botao = new St.Button({style_class: classes.join(' '), child: conteudo, can_focus: true});
                botao.connect('clicked', () => {
                    this._sel = k;
                    this._erro.hide();
                    this._desenharGrade();
                    this._desenharDia();
                });
                row.add_child(botao);
            }
            this._grade.add_child(row);
        }
    }

    _desenharDia() {
        this._listaDia.destroy_all_children();
        const [a, m, d] = this._sel.split('-').map(Number);
        const data = new Date(a, m - 1, d);
        const prefixo = this._sel === L.chaveDeData(new Date()) ? 'Hoje · ' : '';
        this._tituloDia.text = `${prefixo}${L.DIAS_LONGOS[data.getDay()]}, ${d} de ${L.MESES[m - 1].toLowerCase()}`;

        const feriadosDia = L.feriadosDoDia(this._sel);
        for (const f of feriadosDia) {
            const linha = new St.BoxLayout({style_class: 'kimi-ev kimi-ev-feriado'});
            linha.add_child(new St.Icon({icon_name: 'starred-symbolic', icon_size: 14, style_class: 'kimi-fer-icon'}));
            linha.add_child(new St.Label({
                text: f.facultativo ? `${f.nome} (ponto facultativo)` : f.nome,
                style_class: 'kimi-fer',
                x_expand: true,
                y_align: CENTRO,
            }));
            this._listaDia.add_child(linha);
        }

        const doDia = this._eventos.filter(e => e.data === this._sel);
        for (const ev of doDia) {
            const linha = new St.BoxLayout({style_class: 'kimi-ev'});
            linha.add_child(new St.Label({text: ev.hora || 'dia todo', style_class: 'kimi-ev-hora', y_align: CENTRO}));
            linha.add_child(new St.Label({text: ev.titulo, style_class: 'kimi-ev-titulo', x_expand: true, y_align: CENTRO}));
            linha.add_child(this._botaoIcone('user-trash-symbolic', 'kimi-ev-del', () => this._remover(ev.id)));
            this._listaDia.add_child(linha);
        }

        if (doDia.length === 0 && feriadosDia.length === 0)
            this._listaDia.add_child(new St.Label({text: 'Nada agendado. Adicione abaixo.', style_class: 'kimi-vazio'}));
    }

    _desenharMes() {
        this._listaMes.destroy_all_children();
        this._tituloMes.text = `Feriados de ${L.MESES[this._mes].toLowerCase()}`;
        const prefixo = L.chave(this._ano, this._mes, 1).slice(0, 8);
        const fer = L.feriados(this._ano);
        const dias = Object.keys(fer).filter(k => k.startsWith(prefixo)).sort();
        if (dias.length === 0) {
            this._listaMes.add_child(new St.Label({text: 'Nenhum feriado neste mês.', style_class: 'kimi-vazio'}));
            return;
        }
        for (const k of dias) {
            const d = Number(k.slice(8));
            const sem = L.DIAS_LONGOS[new Date(this._ano, this._mes, d).getDay()].slice(0, 3).toLowerCase();
            for (const f of fer[k]) {
                const linha = new St.BoxLayout({style_class: 'kimi-mes-linha'});
                linha.add_child(new St.Label({text: `${String(d).padStart(2, '0')} ${sem}`, style_class: 'kimi-mes-dia'}));
                linha.add_child(new St.Label({
                    text: f.facultativo ? `${f.nome} (facultativo)` : f.nome,
                    style_class: 'kimi-mes-nome',
                    x_expand: true,
                }));
                this._listaMes.add_child(linha);
            }
        }
    }

    // ================= agenda =================
    _adicionar() {
        const titulo = this._campoTitulo.get_text().trim();
        const horaTexto = this._campoHora.get_text().trim();
        if (!titulo) {
            this._mostrarErro('Escreva o nome do compromisso.');
            return;
        }
        let hora = '';
        if (horaTexto) {
            hora = L.normalizarHora(horaTexto);
            if (!hora) {
                this._mostrarErro('Hora inválida. Use por exemplo 14:30 ou 9h.');
                return;
            }
        }
        this._eventos.push({
            id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
            data: this._sel,
            hora,
            titulo,
            avisado: this._jaPassou(this._sel, hora),
        });
        L.ordenar(this._eventos);
        L.salvarAgenda(this._eventos);
        this._campoTitulo.set_text('');
        this._campoHora.set_text('');
        this._erro.hide();
        this._desenharGrade();
        this._desenharDia();
    }

    _remover(id) {
        this._eventos = this._eventos.filter(e => e.id !== id);
        L.salvarAgenda(this._eventos);
        this._desenharGrade();
        this._desenharDia();
    }

    _mostrarErro(texto) {
        this._erro.text = texto;
        this._erro.show();
    }

    _momento(data, hora) {
        const [a, m, d] = data.split('-').map(Number);
        const [hh, mm] = (hora || AVISO_DIA_TODO).split(':').map(Number);
        return new Date(a, m - 1, d, hh, mm);
    }

    _jaPassou(data, hora) {
        return Date.now() - this._momento(data, hora).getTime() > JANELA_AVISO_MIN * 60000;
    }

    _verificarLembretes(inicio) {
        const agora = Date.now();
        let mudou = false;
        for (const ev of this._eventos) {
            if (ev.avisado)
                continue;
            const quando = this._momento(ev.data, ev.hora).getTime();
            if (agora < quando)
                continue;
            ev.avisado = true;
            mudou = true;
            // no login, só avisa o que acabou de vencer ou o que é de hoje
            if (agora - quando <= JANELA_AVISO_MIN * 60000 || (inicio && ev.data === L.chaveDeData(new Date())))
                Main.notify(`Kimi · ${ev.titulo}`, ev.hora ? `Agora, às ${ev.hora}` : 'Compromisso de hoje');
        }
        if (mudou)
            L.salvarAgenda(this._eventos);
    }

    // ================= notas =================
    _construirNotas() {
        const pagina = new St.BoxLayout({style_class: 'kimi-page kimi-notas', x_expand: true});

        // esquerda: lista de notas
        const esq = this._coluna('kimi-col-lista');
        const cab = new St.BoxLayout({style_class: 'kimi-header'});
        cab.add_child(new St.Label({text: 'Notas', style_class: 'kimi-title', x_expand: true, y_align: CENTRO}));
        cab.add_child(this._botaoIcone('list-add-symbolic', 'kimi-add', () => this._novaNota()));
        esq.add_child(cab);
        this._listaNotas = this._coluna('kimi-list');
        esq.add_child(this._rolagem(this._listaNotas, 'kimi-scroll-notas'));
        pagina.add_child(esq);

        pagina.add_child(new St.Widget({style_class: 'kimi-vsep', y_expand: true}));

        // direita: editor
        const dir = this._coluna('kimi-col-editor');
        this._notaTitulo = new St.Entry({hint_text: 'Título da nota', style_class: 'kimi-entry kimi-nota-titulo', can_focus: true, x_expand: true});
        dir.add_child(this._notaTitulo);

        this._notaTexto = new St.Entry({hint_text: 'Escreva aqui…', style_class: 'kimi-entry kimi-nota-texto', can_focus: true, x_expand: true, y_expand: true});
        const ct = this._notaTexto.clutter_text;
        ct.single_line_mode = false;
        ct.activatable = false;
        ct.line_wrap = true;
        ct.line_wrap_mode = 2; // PANGO_WRAP_WORD_CHAR
        const caixaTexto = this._coluna('kimi-nota-caixa');
        caixaTexto.add_child(this._notaTexto);
        dir.add_child(this._rolagem(caixaTexto, 'kimi-scroll-editor'));

        const acoes = new St.BoxLayout({style_class: 'kimi-acoes'});
        this._notaStatus = new St.Label({text: 'Nova nota', style_class: 'kimi-nota-status', x_expand: true, y_align: CENTRO});
        acoes.add_child(this._notaStatus);
        acoes.add_child(this._botaoTexto('user-trash-symbolic', 'Excluir', 'kimi-btn kimi-btn-perigo', () => this._excluirNota()));
        acoes.add_child(this._botaoTexto('document-save-symbolic', 'Salvar', 'kimi-btn kimi-btn-principal', () => this._salvarNota(true)));
        dir.add_child(acoes);
        pagina.add_child(dir);

        this._textoSalvo = {titulo: '', texto: ''};
        return pagina;
    }

    _desenharListaNotas() {
        this._listaNotas.destroy_all_children();
        const notas = L.listarNotas();
        if (notas.length === 0) {
            this._listaNotas.add_child(new St.Label({text: 'Nenhuma nota ainda.\nClique em + para criar.', style_class: 'kimi-vazio'}));
            return;
        }
        for (const nota of notas) {
            const classes = nota.caminho === this._notaAtual ? 'kimi-nota-item kimi-nota-ativa' : 'kimi-nota-item';
            const conteudo = this._coluna('kimi-nota-item-conteudo');
            conteudo.add_child(new St.Label({text: nota.titulo, style_class: 'kimi-nota-item-titulo'}));
            const data = GLib.DateTime.new_from_unix_local(nota.modificado);
            conteudo.add_child(new St.Label({text: data.format('%d/%m · %H:%M'), style_class: 'kimi-nota-item-data'}));
            const botao = new St.Button({style_class: classes, child: conteudo, can_focus: true, x_expand: true});
            botao.connect('clicked', () => this._abrirNota(nota.caminho, nota.titulo));
            this._listaNotas.add_child(botao);
        }
    }

    _carregarNoEditor(caminho, titulo, texto) {
        this._notaAtual = caminho;
        this._notaTitulo.set_text(titulo);
        this._notaTexto.set_text(texto);
        this._textoSalvo = {titulo, texto};
        this._notaStatus.text = caminho ? 'Salva em Documentos/Kimi/Notas' : 'Nova nota';
        this._desenharListaNotas();
    }

    _novaNota() {
        this._salvarNotaSeMudou();
        this._carregarNoEditor(null, '', '');
        this._notaTitulo.grab_key_focus();
    }

    _abrirNota(caminho, titulo) {
        this._salvarNotaSeMudou();
        this._carregarNoEditor(caminho, titulo, L.lerNota(caminho));
    }

    _mudouNota() {
        return this._notaTitulo.get_text() !== this._textoSalvo.titulo ||
            this._notaTexto.get_text() !== this._textoSalvo.texto;
    }

    _salvarNotaSeMudou() {
        if (!this._notaTitulo || !this._mudouNota())
            return;
        const vazia = !this._notaTitulo.get_text().trim() && !this._notaTexto.get_text().trim();
        if (vazia && !this._notaAtual)
            return;
        this._salvarNota(false);
    }

    _salvarNota(manual) {
        const texto = this._notaTexto.get_text();
        const titulo = this._notaTitulo.get_text().trim() || texto.trim().split('\n')[0];
        if (!titulo && !texto.trim()) {
            this._notaStatus.text = 'A nota está vazia.';
            return;
        }
        try {
            this._notaAtual = L.salvarNota(this._notaAtual, titulo, texto);
            const nomeFinal = GLib.path_get_basename(this._notaAtual).slice(0, -4);
            this._notaTitulo.set_text(nomeFinal);
            this._textoSalvo = {titulo: nomeFinal, texto};
            this._notaStatus.text = manual ? 'Salva! ✓' : 'Salva automaticamente';
        } catch (e) {
            this._notaStatus.text = `Erro ao salvar: ${e.message}`;
        }
        this._desenharListaNotas();
    }

    _excluirNota() {
        if (this._notaAtual)
            L.excluirNota(this._notaAtual);
        this._carregarNoEditor(null, '', '');
        this._notaStatus.text = 'Nota enviada para a lixeira.';
    }

    _onDestroy() {
        this._salvarNotaSeMudou();
        this._pararTique();
        this._desligarFoco(false);
        D.encerrar();
        if (this._timer) {
            GLib.Source.remove(this._timer);
            this._timer = null;
        }
        super._onDestroy();
    }
});

export default class KimiExtension extends Extension {
    enable() {
        this._botao = new KimiButton(this.path);
        Main.panel.addToStatusArea(this.uuid, this._botao, 0, 'center');
    }

    disable() {
        this._botao?.destroy();
        this._botao = null;
    }
}
