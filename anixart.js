(function () {
    'use strict';

    // Anixart (anixart.site) — плагин для Lampa
    // Ищет аниме на сайте, берёт плейлист cdnvideohub и запускает HLS-поток.

    var SITE = 'https://anixart.site';
    var API = 'https://plapi.cdnvideohub.com/api/v1/player/sv';
    var PROXY_KEY = 'anixart_proxy'; // необязательный CORS-прокси, напр. https://cors.example.com/?url=

    function proxied(url) {
        var p = Lampa.Storage.get(PROXY_KEY, '');
        return p ? p + encodeURIComponent(url) : url;
    }

    function request(url, ok, fail, post) {
        var net = new Lampa.Reguest();
        net.native(proxied(url), ok, function () { fail && fail(); }, post || false, {
            dataType: 'text',
            headers: { Accept: 'text/html,application/json' }
        });
    }

    function json(url, ok, fail) {
        request(url, function (t) {
            try { ok(typeof t === 'string' ? JSON.parse(t) : t); } catch (e) { fail && fail(); }
        }, fail);
    }

    function abs(u) {
        return u.indexOf('http') === 0 ? u : SITE + (u.charAt(0) === '/' ? '' : '/') + u;
    }

    function parseCards(html) {
        var out = [], re = /<a class="item item-poster[^"]*" href="([^"]+)">[\s\S]*?<img src="([^"]+)"[\s\S]*?item-poster__title[^>]*>([^<]*)<[\s\S]*?item-poster__meta[^>]*>([^<]*)</g, m;
        while ((m = re.exec(html))) {
            out.push({
                url: abs(m[1]),
                img: abs(m[2]),
                title: m[3].trim(),
                meta: m[4].replace(/,\s*$/, '').trim()
            });
        }
        return out;
    }

    function search(query, cb) {
        var body = 'do=search&subaction=search&story=' + encodeURIComponent(query);
        request(SITE + '/index.php', function (html) { cb(parseCards(html)); }, function () { cb(null); }, body);
    }

    function getTitleId(url, cb) {
        request(url, function (html) {
            var id = (html.match(/data-title-id="(\d+)"/) || [])[1];
            var pub = (html.match(/data-publisher-id="(\d+)"/) || [])[1] || '1103';
            var aggr = (html.match(/data-aggregator="([^"]+)"/) || [])[1] || 'mali';
            cb(id ? { id: id, pub: pub, aggr: aggr } : null);
        }, function () { cb(null); });
    }

    function getPlaylist(info, cb) {
        json(API + '/playlist?pub=' + info.pub + '&aggr=' + info.aggr + '&id=' + info.id, function (d) {
            cb(d && d.items && d.items.length ? d : null);
        }, function () { cb(null); });
    }

    function play(item, title) {
        Lampa.Loading.start(function () { Lampa.Loading.stop(); });
        json(API + '/video/' + item.vkId, function (d) {
            Lampa.Loading.stop();
            var s = (d && d.sources) || {};
            var url = s.hlsUrl || s.mpegFullHdUrl || s.mpegHighUrl || s.mpegMediumUrl || s.mpegLowUrl;
            if (!url) return Lampa.Noty.show('Anixart: поток не найден');

            var quality = {};
            [['1080p', s.mpegFullHdUrl], ['720p', s.mpegHighUrl], ['480p', s.mpegMediumUrl], ['360p', s.mpegLowUrl]]
                .forEach(function (q) { if (q[1]) quality[q[0]] = q[1]; });

            var video = { title: title, url: url, quality: quality };
            Lampa.Player.play(video);
            Lampa.Player.playlist([video]);
        }, function () {
            Lampa.Loading.stop();
            Lampa.Noty.show('Anixart: не удалось получить видео');
        });
    }

    function uniq(arr) {
        return arr.filter(function (v, i) { return arr.indexOf(v) === i; });
    }

    function chooseEpisode(data, title, back) {
        var items = data.items;
        var voices = uniq(items.map(function (i) { return i.voiceStudio || 'Озвучка'; }));

        function pickVoice() {
            if (voices.length === 1) return afterVoice(voices[0]);
            Lampa.Select.show({
                title: 'Озвучка',
                items: voices.map(function (v) { return { title: v, v: v }; }),
                onSelect: function (a) { afterVoice(a.v); },
                onBack: back
            });
        }

        function afterVoice(voice) {
            var list = items.filter(function (i) { return (i.voiceStudio || 'Озвучка') === voice; });
            if (!data.isSerial) return play(list[0], title);

            var seasons = uniq(list.map(function (i) { return i.season || 1; })).sort(function (a, b) { return a - b; });

            function pickSeason() {
                if (seasons.length === 1) return pickEpisode(seasons[0]);
                Lampa.Select.show({
                    title: 'Сезон',
                    items: seasons.map(function (s) { return { title: 'Сезон ' + s, s: s }; }),
                    onSelect: function (a) { pickEpisode(a.s); },
                    onBack: pickVoice
                });
            }

            function pickEpisode(season) {
                var eps = list.filter(function (i) { return (i.season || 1) === season; })
                    .sort(function (a, b) { return a.episode - b.episode; });
                Lampa.Select.show({
                    title: 'Серия',
                    items: eps.map(function (e) { return { title: 'Серия ' + e.episode, e: e }; }),
                    onSelect: function (a) {
                        play(a.e, title + ' — S' + season + 'E' + a.e.episode);
                    },
                    onBack: seasons.length > 1 ? pickSeason : pickVoice
                });
            }

            pickSeason();
        }

        pickVoice();
    }

    function openResult(res, back) {
        Lampa.Loading.start(function () { Lampa.Loading.stop(); });
        getTitleId(res.url, function (info) {
            if (!info) {
                Lampa.Loading.stop();
                return Lampa.Noty.show('Anixart: плеер на странице не найден');
            }
            getPlaylist(info, function (data) {
                Lampa.Loading.stop();
                if (!data) return Lampa.Noty.show('Anixart: для этого тайтла нет доступного видео');
                chooseEpisode(data, res.title, back);
            });
        });
    }

    function start(movie) {
        var queries = uniq([movie.title || movie.name, movie.original_title || movie.original_name]
            .filter(Boolean));
        var results = [];

        Lampa.Loading.start(function () { Lampa.Loading.stop(); });

        (function next(i) {
            if (i >= queries.length) {
                Lampa.Loading.stop();
                if (!results.length) return Lampa.Noty.show('Anixart: ничего не найдено');
                return show();
            }
            search(queries[i], function (r) {
                (r || []).forEach(function (x) {
                    if (!results.some(function (y) { return y.url === x.url; })) results.push(x);
                });
                next(i + 1);
            });
        })(0);

        function show() {
            var controller = Lampa.Controller.enabled().name;
            Lampa.Select.show({
                title: 'Anixart',
                items: results.map(function (r) {
                    return { title: r.title, subtitle: r.meta, r: r };
                }),
                onSelect: function (a) { openResult(a.r, show); },
                onBack: function () { Lampa.Controller.toggle(controller); }
            });
        }
    }

    var CATEGORIES = [
        { title: 'Новые серии', path: null },
        { title: 'Онгоинги', path: '/ongoingi/' },
        { title: 'Завершённые', path: '/zavershennye/' },
        { title: 'Анонсы', path: '/anonsy/' },
        { title: 'Все аниме', path: '/' }
    ];

    function Catalog(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var html = $('<div></div>');
        var body = $('<div class="category-full"></div>');
        var page = 0, busy = false, done = false, last;
        var self = this;

        function addCards(list) {
            list.forEach(function (r) {
                var card = Lampa.Template.get('card', { title: r.title, release_year: r.meta });
                card.addClass('card--collection');
                card.find('.card__img').attr('src', r.img);
                card.on('hover:focus', function () {
                    last = card[0];
                    scroll.update(card, true);
                });
                card.on('hover:enter', function () {
                    openResult(r, function () { Lampa.Controller.toggle('content'); });
                });
                body.append(card);
            });
        }

        function load() {
            if (busy || done) return;
            busy = true;
            page++;
            var url = SITE + object.path + (page > 1 ? 'page/' + page + '/' : '');
            if (page === 1) Lampa.Activity.loader(true);
            request(url, function (res) {
                var list = parseCards(res);
                busy = false;
                if (!list.length) done = true;
                addCards(list);
                if (page === 1) {
                    Lampa.Activity.loader(false);
                    Lampa.Activity.toggle();
                    if (!list.length) Lampa.Noty.show('Anixart: ничего не найдено');
                } else if (list.length) {
                    Lampa.Controller.collectionSet(scroll.render());
                }
            }, function () {
                busy = false;
                done = true;
                Lampa.Activity.loader(false);
                Lampa.Noty.show('Anixart: не удалось загрузить каталог');
            });
        }

        this.create = function () {
            scroll.onEnd = load;
            scroll.minus();
            scroll.append(body);
            html.append(scroll.render());
            load();
            return this.render();
        };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () { Navigator.move('right'); },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () { if (Navigator.canmove('down')) Navigator.move('down'); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.render = function () { return html; };
        this.destroy = function () {
            scroll.destroy();
            html.remove();
            body.remove();
        };
    }

    function openNewEpisodes() {
        Lampa.Loading.start(function () { Lampa.Loading.stop(); });
        request(SITE + '/', function (res) {
            Lampa.Loading.stop();
            var items = [], re = /<a href="([^"]+)" class="fr__title1[^"]*">([^<]+)<\/a>[\s\S]*?<div class="fr__year1"><span>([^<]*)<\/span>/g, m;
            while ((m = re.exec(res))) {
                items.push({ title: m[2].trim(), subtitle: m[3] + ' серия', r: { url: abs(m[1]), title: m[2].trim() } });
            }
            if (!items.length) return Lampa.Noty.show('Anixart: список новых серий пуст');
            var controller = Lampa.Controller.enabled().name;
            (function show() {
                Lampa.Select.show({
                    title: 'Новые серии',
                    items: items,
                    onSelect: function (a) { openResult(a.r, show); },
                    onBack: function () { Lampa.Controller.toggle(controller); }
                });
            })();
        }, function () {
            Lampa.Loading.stop();
            Lampa.Noty.show('Anixart: не удалось загрузить список');
        });
    }

    function openCatalog() {
        var controller = Lampa.Controller.enabled().name;
        Lampa.Select.show({
            title: 'Anixart',
            items: CATEGORIES,
            onSelect: function (c) {
                if (!c.path) return openNewEpisodes();
                Lampa.Activity.push({
                    url: '',
                    title: 'Anixart — ' + c.title,
                    component: 'anixart_catalog',
                    path: c.path,
                    page: 1
                });
            },
            onBack: function () { Lampa.Controller.toggle(controller); }
        });
    }

    function addMenu() {
        if ($('.menu .view--anixart-menu').length) return;
        var item = $('<li class="menu__item selector view--anixart-menu">' +
            '<div class="menu__ico"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>' +
            '<div class="menu__text">Anixart</div></li>');
        item.on('hover:enter', openCatalog);
        $('.menu .menu__list').eq(0).append(item);
    }

    function addButton(e) {
        var render = e.object.activity.render();
        if (render.find('.view--anixart').length) return;

        var btn = $('<div class="full-start__button selector view--anixart">' +
            '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
            '<span>Anixart</span></div>');

        btn.on('hover:enter', function () { start(e.data.movie); });

        var torrent = render.find('.view--torrent');
        if (torrent.length) torrent.before(btn);
        else render.find('.full-start-new__buttons, .full-start__buttons').first().append(btn);
    }

    function settings() {
        Lampa.SettingsApi.addComponent({ component: 'anixart', name: 'Anixart', icon: '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' });
        Lampa.SettingsApi.addParam({
            component: 'anixart',
            param: { name: PROXY_KEY, type: 'input', 'default': '', placeholder: 'https://proxy/?url=' },
            field: { name: 'CORS-прокси', description: 'Необязательно. Адрес вида https://proxy/?url= — для устройств, где запросы к сайту блокируются' }
        });
    }

    function init() {
        if (window.anixart_plugin) return;
        window.anixart_plugin = true;

        settings();
        Lampa.Component.add('anixart_catalog', Catalog);
        addMenu();
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') addButton(e);
        });
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
