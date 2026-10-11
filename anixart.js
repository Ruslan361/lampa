(function () {
    'use strict';

    // Anixart (anixart.site) — плагин для Lampa
    // Каталог с фильтрами, вкладка в поиске Lampa, просмотр через плеер cdnvideohub.

    var SITE = 'https://anixart.site';
    var API = 'https://plapi.cdnvideohub.com/api/v1/player/sv';
    var PROXY_KEY = 'anixart_proxy'; // свой CORS-прокси, напр. https://cors.example.com/?url=
    var FILTER_KEY = 'anixart_filter';
    var TMDB_KEY = 'anixart_tmdb_card';
    var DEFAULT_PROXY = 'https://api.allorigins.win/raw?url=';
    var ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

    var GENRES = ['Сёнен', 'Сэйнэн', 'Сёдзё', 'Сёдзё-ай', 'Дзёсей', 'Комедия', 'Романтика', 'Школа', 'Безумие',
        'Боевые искусства', 'Вампиры', 'Военное', 'Гарем', 'Гурман', 'Демоны', 'Детектив', 'Детское', 'Драма',
        'Игры', 'Исторический', 'Космос', 'Магия', 'Машины', 'Меха', 'Музыка', 'Пародия', 'Повседневность',
        'Полиция', 'Приключения', 'Психологическое', 'Работа', 'Самураи', 'Сверхъестественное', 'Спорт',
        'Супер сила', 'Ужасы', 'Фантастика', 'Фэнтези', 'Экшен', 'Этти', 'Триллер'];
    var STATUSES = [['9', 'Онгоинги'], ['11', 'Завершённые'], ['10', 'Анонсы']];
    var TYPES = ['ТВ-сериал', 'OVA', 'ONA', 'Фильм'];
    var SORTS = [['date', 'Дате добавления'], ['news_read', 'Просмотрам'], ['rating', 'Рейтингу'],
        ['d.reiting', 'Рейтингу Shikimori'], ['d.god', 'Году'], ['title', 'Алфавиту'], ['comm_num', 'Комментариям']];

    // Тайтлы, открытые из каталога в карточке TMDB: id TMDB -> страница anixart
    var linked = {};

    /* ---------- сеть ---------- */

    // Сайт не отдаёт CORS-заголовки, поэтому в браузере/на ТВ прямой запрос падает.
    // Пробуем по очереди: свой прокси (если задан) или напрямую, затем публичный прокси.
    // Удачный вариант запоминаем, чтобы не ждать ошибку на каждом запросе.
    var working = null;

    function routes() {
        var own = Lampa.Storage.get(PROXY_KEY, '');
        // Публичный прокси нестабилен (часто отвечает 522), поэтому даём ему несколько попыток.
        return own ? [own, own] : ['', DEFAULT_PROXY, DEFAULT_PROXY, DEFAULT_PROXY, DEFAULT_PROXY];
    }

    function request(url, ok, fail) {
        var list = routes();
        if (working !== null && list.indexOf(working) >= 0) {
            list = list.filter(function (r) { return r === working; })
                .concat(list.filter(function (r) { return r !== working; }));
        }

        (function attempt(i) {
            if (i >= list.length) return fail && fail();
            var route = list[i];
            var net = new Lampa.Reguest();
            net.timeout(20000);
            net.native(route ? route + encodeURIComponent(url) : url, function (res) {
                if (typeof res !== 'string' || !res.length) return attempt(i + 1);
                working = route;
                ok(res);
            }, function () { attempt(i + 1); }, false, { dataType: 'text' });
        })(0);
    }

    // API cdnvideohub и TMDB отдают CORS-заголовки — к ним напрямую.
    function json(url, ok, fail) {
        var net = new Lampa.Reguest();
        net.timeout(15000);
        net.silent(url, function (d) {
            try { ok(typeof d === 'string' ? JSON.parse(d) : d); } catch (e) { fail && fail(); }
        }, function () { fail && fail(); });
    }

    /* ---------- разбор сайта ---------- */

    function abs(u) {
        return u.indexOf('http') === 0 ? u : SITE + (u.charAt(0) === '/' ? '' : '/') + u;
    }

    function decode(s) {
        return s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&').trim();
    }

    function parseCards(html) {
        var out = [], re = /<a class="item item-poster[^"]*" href="([^"]+)">([\s\S]*?)<\/a>/g, m;
        while ((m = re.exec(html))) {
            var b = m[2];
            var img = (b.match(/<img src="([^"]+)"/) || [])[1];
            var title = (b.match(/item-poster__title[^>]*>([^<]*)</) || [])[1];
            if (!img || !title) continue;
            var meta = ((b.match(/item-poster__meta[^>]*>([^<]*)</) || [])[1] || '').replace(/,\s*$/, '').trim();
            out.push({
                url: abs(m[1]),
                img: abs(img),
                title: decode(title),
                meta: meta,
                year: (meta.match(/\b(19|20)\d{2}\b/) || [''])[0],
                rating: parseFloat((b.match(/item__rating">([\d.]+)</) || [])[1]) || 0
            });
        }
        return out;
    }

    function lastPage(html) {
        var max = 1, re = /\/page\/(\d+)\//g, m;
        while ((m = re.exec(html))) max = Math.max(max, parseInt(m[1], 10));
        return max;
    }

    function parseTitlePage(html) {
        var id = (html.match(/data-title-id="(\d+)"/) || [])[1];
        return {
            id: id,
            pub: (html.match(/data-publisher-id="(\d+)"/) || [])[1] || '1103',
            aggr: (html.match(/data-aggregator="([^"]+)"/) || [])[1] || 'mali',
            original: decode((html.match(/pmovie__original">([^<]*)</) || [])[1] || '')
        };
    }

    function search(query, cb) {
        var url = SITE + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);
        request(url, function (html) { cb(parseCards(html)); }, function () { cb(null); });
    }

    // Карточка в формате Lampa (TMDB-подобный объект)
    function toCard(r) {
        return {
            id: 'anixart_' + ((r.url.match(/\/(\d+)-/) || [])[1] || r.url),
            title: r.title,
            original_title: r.title,
            img: r.img,
            poster: r.img,
            release_date: r.year,
            vote_average: r.rating,
            anixart: r
        };
    }

    /* ---------- фильтр ---------- */

    function getFilter() {
        var f = Lampa.Storage.get(FILTER_KEY, '{}');
        if (typeof f === 'string') { try { f = JSON.parse(f); } catch (e) { f = {}; } }
        return f || {};
    }

    function filterPath(f) {
        var enc = function (v) { return encodeURIComponent(v).replace(/%20/g, '+'); };
        var parts = [];
        if (f.zhanr) parts.push('zhanr=' + enc(f.zhanr));
        if (f.cat) parts.push('cat=' + f.cat);
        if (f.tip) parts.push('tip=' + enc(f.tip));
        if (f.god) parts.push('god=' + f.god);
        parts.push('sort=' + (f.sort || 'date'));
        parts.push('order=desc');
        return '/f/' + parts.join('/') + '/';
    }

    function label(list, value) {
        for (var i = 0; i < list.length; i++) if (list[i][0] === value) return list[i][1];
        return value;
    }

    function openFilter(back) {
        var f = getFilter();
        var years = [];
        for (var y = new Date().getFullYear() + 1; y >= 1980; y--) years.push(String(y));

        function sub(title, key, values, allTitle) {
            var items = [{ title: allTitle || 'Все', v: '' }].concat(values.map(function (v) {
                return typeof v === 'string' ? { title: v, v: v } : { title: v[1], v: v[0] };
            }));
            items.forEach(function (i) { i.selected = (f[key] || '') === i.v; });
            Lampa.Select.show({
                title: title,
                items: items,
                onSelect: function (a) { f[key] = a.v; Lampa.Storage.set(FILTER_KEY, f); main(); },
                onBack: main
            });
        }

        function main() {
            Lampa.Select.show({
                title: 'Фильтр',
                items: [
                    { title: 'Показать', apply: true },
                    { title: 'Жанр', subtitle: f.zhanr || 'Все', key: 'zhanr' },
                    { title: 'Статус', subtitle: f.cat ? label(STATUSES, f.cat) : 'Все', key: 'cat' },
                    { title: 'Тип', subtitle: f.tip || 'Все', key: 'tip' },
                    { title: 'Год', subtitle: f.god || 'Все', key: 'god' },
                    { title: 'Сортировка', subtitle: 'По ' + label(SORTS, f.sort || 'date').toLowerCase(), key: 'sort' },
                    { title: 'Сбросить', reset: true }
                ],
                onSelect: function (a) {
                    if (a.apply) {
                        var name = [f.zhanr, f.cat && label(STATUSES, f.cat), f.tip, f.god].filter(Boolean).join(', ');
                        return openCatalog(filterPath(f), name || 'Фильтр');
                    }
                    if (a.reset) { f = {}; Lampa.Storage.set(FILTER_KEY, f); return main(); }
                    if (a.key === 'zhanr') sub('Жанр', 'zhanr', GENRES);
                    if (a.key === 'cat') sub('Статус', 'cat', STATUSES);
                    if (a.key === 'tip') sub('Тип', 'tip', TYPES);
                    if (a.key === 'god') sub('Год', 'god', years);
                    if (a.key === 'sort') {
                        var items = SORTS.map(function (s) { return { title: s[1], v: s[0], selected: (f.sort || 'date') === s[0] }; });
                        Lampa.Select.show({
                            title: 'Сортировка',
                            items: items,
                            onSelect: function (s) { f.sort = s.v; Lampa.Storage.set(FILTER_KEY, f); main(); },
                            onBack: main
                        });
                    }
                },
                onBack: back
            });
        }

        main();
    }

    /* ---------- каталог (родная сетка Lampa) ---------- */

    // На странице сайта 12 тайтлов — грузим по две страницы сайта за раз, чтобы сетка заполняла экран.
    function loadPage(path, page, ok, fail) {
        var got = [], done = 0, total = 1, failed = 0;
        [page * 2 - 1, page * 2].forEach(function (p, idx) {
            var url = SITE + path + (p > 1 ? 'page/' + p + '/' : '');
            request(url, function (html) {
                got[idx] = parseCards(html);
                total = Math.max(total, lastPage(html));
                finish();
            }, function () { failed++; got[idx] = []; finish(); });
        });

        function finish() {
            if (++done < 2) return;
            if (failed === 2) return fail();
            var seen = {}, results = [];
            got[0].concat(got[1]).forEach(function (r) {
                if (!seen[r.url]) { seen[r.url] = 1; results.push(toCard(r)); }
            });
            ok({ results: results, page: page, total_pages: Math.ceil(total / 2) });
        }
    }

    function Catalog(object) {
        var comp = new Lampa.InteractionCategory(object);

        comp.create = function () {
            var self = this;
            this.activity.loader(true);
            loadPage(object.path, 1, function (data) { self.build(data); }, function () {
                Lampa.Noty.show('Anixart: не удалось загрузить каталог. Проверьте прокси в настройках');
                self.empty();
            });
            return this.render();
        };

        comp.nextPageReuest = function (object, resolve, reject) {
            loadPage(object.path, object.page, resolve.bind(comp), reject.bind(comp));
        };

        comp.cardRender = function (object, element, card) {
            card.onEnter = function () { openTitle(element.anixart); };
        };

        return comp;
    }

    function openCatalog(path, title) {
        Lampa.Activity.push({
            url: '',
            title: 'Anixart — ' + title,
            component: 'anixart_catalog',
            path: path,
            page: 1
        });
    }

    var SECTIONS = [
        { title: 'Новинки', path: filterPath({ sort: 'date' }) },
        { title: 'Новые серии', episodes: true },
        { title: 'Онгоинги', path: filterPath({ cat: '9', sort: 'date' }) },
        { title: 'Популярные', path: filterPath({ sort: 'news_read' }) },
        { title: 'Лучшие по рейтингу', path: filterPath({ sort: 'rating' }) },
        { title: 'Фильмы', path: filterPath({ tip: 'Фильм', sort: 'date' }) },
        { title: 'Анонсы', path: filterPath({ cat: '10', sort: 'date' }) },
        { title: 'Завершённые', path: filterPath({ cat: '11', sort: 'date' }) },
        { title: 'Фильтр…', filter: true }
    ];

    function openMenu() {
        var controller = Lampa.Controller.enabled().name;
        var back = function () { Lampa.Controller.toggle(controller); };
        (function show() {
            Lampa.Select.show({
                title: 'Anixart',
                items: SECTIONS,
                onSelect: function (s) {
                    if (s.filter) return openFilter(show);
                    if (s.episodes) return openNewEpisodes(show);
                    openCatalog(s.path, s.title);
                },
                onBack: back
            });
        })();
    }

    function openNewEpisodes(back) {
        Lampa.Loading.start(function () { Lampa.Loading.stop(); });
        request(SITE + '/', function (res) {
            Lampa.Loading.stop();
            var items = [], re = /<a href="([^"]+)" class="fr__title1[^"]*">([^<]+)<\/a>[\s\S]*?<div class="fr__year1"><span>([^<]*)<\/span>/g, m;
            while ((m = re.exec(res))) {
                var t = decode(m[2]);
                items.push({ title: t, subtitle: m[3] + ' серия', r: { url: abs(m[1]), title: t } });
            }
            if (!items.length) return Lampa.Noty.show('Anixart: список новых серий пуст');
            (function show() {
                Lampa.Select.show({
                    title: 'Новые серии',
                    items: items,
                    onSelect: function (a) { openTitle(a.r, show); },
                    onBack: back
                });
            })();
        }, function () {
            Lampa.Loading.stop();
            Lampa.Noty.show('Anixart: не удалось загрузить список. Проверьте прокси в настройках');
        });
    }

    /* ---------- открытие тайтла ---------- */

    // Ищем тайтл в TMDB, чтобы открыть родную карточку Lampa (описание, фон, актёры).
    function findTmdb(r, info, cb) {
        var queries = [info.original, r.title].filter(Boolean);
        var year = parseInt(r.year, 10) || 0;

        (function next(i) {
            if (i >= queries.length) return cb(null);
            var url = Lampa.TMDB.api('search/multi?api_key=' + Lampa.TMDB.key() + '&language=' + Lampa.Storage.get('language', 'ru') +
                '&include_adult=false&query=' + encodeURIComponent(queries[i]));
            json(url, function (d) {
                var best = null, bestScore = 0;
                (d.results || []).forEach(function (x) {
                    if (x.media_type !== 'tv' && x.media_type !== 'movie') return;
                    var score = 0;
                    if ((x.genre_ids || []).indexOf(16) >= 0) score += 2;
                    if (x.original_language === 'ja' || x.original_language === 'zh' || x.original_language === 'ko') score += 1;
                    var y = parseInt((x.first_air_date || x.release_date || '').slice(0, 4), 10);
                    if (year && y && Math.abs(y - year) <= 1) score += 2;
                    if (score > bestScore) { best = x; bestScore = score; }
                });
                if (best && bestScore >= 3) cb(best);
                else next(i + 1);
            }, function () { next(i + 1); });
        })(0);
    }

    function openTitle(r, back) {
        var controller = Lampa.Controller.enabled().name;
        back = back || function () { Lampa.Controller.toggle(controller); };

        Lampa.Loading.start(function () { Lampa.Loading.stop(); });
        request(r.url, function (html) {
            var info = parseTitlePage(html);

            if (Lampa.Storage.get(TMDB_KEY, true) === false || Lampa.Storage.get(TMDB_KEY, true) === 'false') {
                Lampa.Loading.stop();
                return watch(r, info, back);
            }

            findTmdb(r, info, function (tmdb) {
                Lampa.Loading.stop();
                if (!tmdb) return watch(r, info, back);
                linked[tmdb.id] = { r: r, info: info };
                Lampa.Activity.push({
                    url: '',
                    component: 'full',
                    id: tmdb.id,
                    method: tmdb.media_type,
                    card: tmdb,
                    source: 'tmdb'
                });
            });
        }, function () {
            Lampa.Loading.stop();
            Lampa.Noty.show('Anixart: не удалось открыть страницу тайтла');
        });
    }

    function watch(r, info, back) {
        if (!info || !info.id) return Lampa.Noty.show('Anixart: плеер на странице не найден');
        Lampa.Loading.start(function () { Lampa.Loading.stop(); });
        json(API + '/playlist?pub=' + info.pub + '&aggr=' + info.aggr + '&id=' + info.id, function (d) {
            Lampa.Loading.stop();
            if (!d || !d.items || !d.items.length) return Lampa.Noty.show('Anixart: для этого тайтла нет доступного видео');
            chooseEpisode(d, r.title, back);
        }, function () {
            Lampa.Loading.stop();
            Lampa.Noty.show('Anixart: не удалось загрузить плейлист');
        });
    }

    /* ---------- плеер ---------- */

    // Веб-плеер Lampa создаёт <video crossorigin="anonymous">, а okcdn не отдаёт CORS-заголовки,
    // поэтому браузер блокирует видео. На время нашего воспроизведения снимаем атрибут:
    // обычному <video> без crossorigin CORS не нужен.
    var ours = false;

    function stripCors(v) {
        if (!v || !v.hasAttribute('crossorigin')) return false;
        v.removeAttribute('crossorigin');
        return true;
    }

    function patchPlayer() {
        new MutationObserver(function (list) {
            if (!ours) return;
            list.forEach(function (m) {
                [].forEach.call(m.addedNodes, function (n) {
                    if (n.nodeType !== 1) return;
                    if (n.tagName === 'VIDEO') stripCors(n);
                    else if (n.querySelectorAll) [].forEach.call(n.querySelectorAll('video'), stripCors);
                });
            });
        }).observe(document.body, { childList: true, subtree: true });

        Lampa.Player.listener.follow('ready', function () {
            if (!ours) return;
            // Если элемент успел начать загрузку с crossorigin — перезапускаем её без него.
            var v = document.querySelector('.player-video__video');
            if (stripCors(v) && v.src) v.load();
        });

        Lampa.Player.listener.follow('destroy', function () { ours = false; });
    }

    function play(item, title) {
        Lampa.Loading.start(function () { Lampa.Loading.stop(); });
        json(API + '/video/' + item.vkId, function (d) {
            Lampa.Loading.stop();
            var s = (d && d.sources) || {};

            // MP4 вместо HLS: okcdn не отдаёт CORS-заголовки, а hls.js без них не работает.
            var quality = {};
            [['2160p', s.mpeg4kUrl], ['1440p', s.mpegQhdUrl], ['1080p', s.mpegFullHdUrl], ['720p', s.mpegHighUrl],
                ['480p', s.mpegMediumUrl], ['360p', s.mpegLowUrl], ['240p', s.mpegLowestUrl]]
                .forEach(function (q) { if (q[1]) quality[q[0]] = q[1]; });

            var keys = Object.keys(quality);
            var url = keys.length ? quality[keys[0]] : s.hlsUrl;
            if (!url) return Lampa.Noty.show('Anixart: поток не найден');

            var video = { title: title, url: url, quality: quality };
            ours = true;
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
                items: voices.map(function (v) {
                    var n = items.filter(function (i) { return (i.voiceStudio || 'Озвучка') === v; }).length;
                    return { title: v, subtitle: data.isSerial ? n + ' сер.' : '', v: v };
                }),
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
                    onBack: voices.length > 1 ? pickVoice : back
                });
            }

            function pickEpisode(season) {
                var eps = list.filter(function (i) { return (i.season || 1) === season; })
                    .sort(function (a, b) { return a.episode - b.episode; });
                Lampa.Select.show({
                    title: 'Серия',
                    items: eps.map(function (e) { return { title: 'Серия ' + e.episode, subtitle: voice, e: e }; }),
                    onSelect: function (a) {
                        play(a.e, title + ' — S' + season + 'E' + a.e.episode);
                    },
                    onBack: seasons.length > 1 ? pickSeason : (voices.length > 1 ? pickVoice : back)
                });
            }

            pickSeason();
        }

        pickVoice();
    }

    /* ---------- кнопка в карточке ---------- */

    function searchAndWatch(movie) {
        var controller = Lampa.Controller.enabled().name;
        var back = function () { Lampa.Controller.toggle(controller); };
        var queries = uniq([movie.title || movie.name, movie.original_title || movie.original_name].filter(Boolean));
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
            Lampa.Select.show({
                title: 'Anixart',
                items: results.map(function (r) { return { title: r.title, subtitle: r.meta, r: r }; }),
                onSelect: function (a) {
                    Lampa.Loading.start(function () { Lampa.Loading.stop(); });
                    request(a.r.url, function (html) {
                        Lampa.Loading.stop();
                        watch(a.r, parseTitlePage(html), show);
                    }, function () {
                        Lampa.Loading.stop();
                        Lampa.Noty.show('Anixart: не удалось открыть страницу тайтла');
                    });
                },
                onBack: back
            });
        }
    }

    function addButton(e) {
        var render = e.object.activity.render();
        if (render.find('.view--anixart').length) return;

        var movie = e.data.movie;
        var btn = $('<div class="full-start__button selector view--anixart">' + ICON + '<span>Anixart</span></div>');

        btn.on('hover:enter', function () {
            var link = linked[movie.id];
            if (link) {
                var controller = Lampa.Controller.enabled().name;
                watch(link.r, link.info, function () { Lampa.Controller.toggle(controller); });
            } else searchAndWatch(movie);
        });

        var torrent = render.find('.view--torrent');
        if (torrent.length) torrent.before(btn);
        else render.find('.full-start-new__buttons, .full-start__buttons').first().prepend(btn);
    }

    /* ---------- поиск Lampa ---------- */

    function addSearch() {
        Lampa.Search.addSource({
            title: 'Anixart',
            params: { lazy: true, align_left: true, nofound: 'Ничего не найдено' },
            search: function (params, oncomplite) {
                search(decodeURIComponent(params.query), function (r) {
                    oncomplite(r && r.length ? [{ title: 'Anixart', results: r.map(toCard) }] : []);
                });
            },
            onCancel: function () {},
            onSelect: function (params, close) {
                close();
                openTitle(params.element.anixart);
            }
        });
    }

    /* ---------- меню и настройки ---------- */

    function addMenu() {
        if ($('.menu .view--anixart-menu').length) return;
        var item = $('<li class="menu__item selector view--anixart-menu">' +
            '<div class="menu__ico">' + ICON + '</div>' +
            '<div class="menu__text">Anixart</div></li>');
        item.on('hover:enter', openMenu);
        $('.menu .menu__list').eq(0).append(item);
    }

    function settings() {
        Lampa.SettingsApi.addComponent({ component: 'anixart', name: 'Anixart', icon: ICON });
        Lampa.SettingsApi.addParam({
            component: 'anixart',
            param: { name: TMDB_KEY, type: 'trigger', 'default': true },
            field: { name: 'Открывать карточку TMDB', description: 'Показывать описание и фон из TMDB. Если выключено — сразу выбор серии' }
        });
        Lampa.SettingsApi.addParam({
            component: 'anixart',
            param: { name: PROXY_KEY, type: 'input', values: '', 'default': '', placeholder: 'https://proxy/?url=' },
            field: { name: 'CORS-прокси', description: 'Необязательно. По умолчанию используется api.allorigins.win. Свой адрес вида https://proxy/?url=' }
        });
    }

    function init() {
        if (window.anixart_plugin) return;
        window.anixart_plugin = true;

        settings();
        Lampa.Component.add('anixart_catalog', Catalog);
        addMenu();
        addSearch();
        patchPlayer();
        Lampa.Listener.follow('full', function (e) {
            if (e.type === 'complite') addButton(e);
        });
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type === 'ready') init(); });
})();
