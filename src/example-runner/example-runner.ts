import './example-runner.scss';
import * as angular from 'angular';
import * as Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-java';

const docs: angular.IModule = angular.module('documentation', ['ngCookies']);

const LanguageMap: {[key: string]: Prism.LanguageDefinition} = {
    js: Prism.languages.javascript,
    ts: Prism.languages.typescript,
    css: Prism.languages.css,
    sh: Prism.languages.bash,
    html: Prism.languages.html,
    jsx: Prism.languages.jsx,
    java: Prism.languages.java
};

function highlight(code: string, language: string): string {
    const prismLanguage = LanguageMap[language];
    return Prism.highlight(code, prismLanguage);
}

docs.service('HighlightService', function() {
    this.highlight = function(code: string, language: string) {
        return highlight(code, language);
    };
});

function whenInViewPort(element, callback) {
    function comparePosition() {
        var scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0;
        var scrollPos = scrollTop + document.documentElement.clientHeight;
        var elemTop = element[0].getBoundingClientRect().top;

        if (scrollPos >= elemTop) {
            window.removeEventListener('scroll', comparePosition);
            callback();
            // setTimeout(callback, 2000);
        }
    }

    comparePosition();
    window.addEventListener('scroll', comparePosition);
}

docs.directive('snippet', function() {
    return {
        restrict: 'E',
        scope: {
            language: '='
        },
        link: function(scope, element, attrs) {
            whenInViewPort(element, function() {
                const language = attrs.language || 'js';
                const highlightedSource = highlight(element.text(), language);
                element.empty().html('<pre><code>' + highlightedSource + '</code></pre>');
            });
        }
    };
});

// taken from https://github.com/angular/angular.js/blob/489835dd0b36a108bedd5ded439a186aca4fa739/docs/app/src/examples.js#L53
docs.factory('formPostData', [
    '$document',
    function($document) {
        return function(url, newWindow, fields) {
            /*
             * If the form posts to target="_blank", pop-up blockers can cause it not to work.
             * If a user choses to bypass pop-up blocker one time and click the link, they will arrive at
             * a new default plnkr, not a plnkr with the desired template.  Given this undesired behavior,
             * some may still want to open the plnk in a new window by opting-in via ctrl+click.  The
             * newWindow param allows for this possibility.
             */
            var target = newWindow ? '_blank' : '_self';
            var form: any = angular.element('<form style="display: none;" method="post" action="' + url + '" target="' + target + '"></form>');
            angular.forEach(fields, function(value, name) {
                var input = angular.element('<input type="hidden" name="' + name + '">');
                input.attr('value', value);
                form.append(input);
            });
            $document.find('body').append(form);
            form[0].submit();
            form.remove();
        };
    }
]);

class ExampleRunner {
    ready: boolean = false;
    private source: any;
    private loadingSource: boolean;
    private selectedTab: string;

    private selectedFile: string;
    private resultUrl: string;

    private files: string[];
    private title: string;
    private section: string;
    private name: string;
    private type: string;
    private currentType: string;
    private boilerplateFiles: string[];
    private boilerplatePath: string;

    private options: {
        sourcePrefix: string;
        showResult?: boolean;
        initialFile?: string;
        exampleHeight?: number;
    };

    private config: any;

    private iframeStyle: any;

    constructor(
        private $http: angular.IHttpService,
        private $timeout: angular.ITimeoutService,
        private $sce: angular.ISCEService,
        private $q: angular.IQService,
        private formPostData,
        private $element: Element,
        private $cookies: angular.cookies.ICookiesService
    ) {
        $http.defaults.cache = true;
    }

    private availableTypes: string[];

    private openFwDropdown: boolean = false;

    toggleFwDropdown() {
        this.openFwDropdown = !this.openFwDropdown;
    }

    hideFwDropdown() {
        this.$timeout(() => (this.openFwDropdown = false), 200);
    }

    $onInit() {
        this.iframeStyle = {};

        const options = this.config.options;

        if (options.exampleHeight) {
            this.iframeStyle.height = options.exampleHeight + 'px';
        }

        this.selectedTab = options.showResult === false ? 'code' : 'result';

        this.title = this.config.title;
        this.name = this.config.name;
        this.section = this.config.section;

        this.availableTypes = Object.keys(this.config.types);

        whenInViewPort(this.$element, () => {
            this.$timeout(() => {
                console.log(this.getInitialType())
                this.setType(this.getInitialType());
                this.ready = true;
            });
        });
    }

    getInitialType(): string {
        const selectedFramework = this.$cookies.get('agGridFramework');
        const selectedRunnerVersion = this.$cookies.get('agGridRunnerVersion');

        if (this.availableTypes.indexOf(selectedRunnerVersion) > -1) {
            return selectedRunnerVersion;
        } else if (this.availableTypes.indexOf(selectedFramework) > -1) {
            return selectedFramework;
        } else {
            return this.availableTypes[0];
        }
    }

    setAndPersistType(type: string) {
        this.setType(type);
        const tenYearsFromNow = new Date();
        tenYearsFromNow.setFullYear(tenYearsFromNow.getFullYear() + 10);
        this.$cookies.put('agGridRunnerVersion', type, {
            expires: tenYearsFromNow
        });
    }

    setType(type: string) {
        const typeConfig = this.config.types[type];

        this.boilerplateFiles = typeConfig.boilerplateFiles || [];
        this.boilerplatePath = typeConfig.boilerplatePath;

        const files = typeConfig.files;

        this.files = files[0] === 'index.html' ? files : ['index.html'].concat(files);

        this.selectedFile = this.files[1];

        this.resultUrl = typeConfig.resultUrl;

        this.currentType = type;

        this.loadAllSources();
        this.refreshSource();

        this.openFwDropdown = false;
    }

    private sources: any;
    private allFiles: any;

    loadAllSources() {
        this.allFiles = this.files.concat(this.boilerplateFiles);
        this.$q.all(this.allFiles.map((file: any) => this.$http.get(this.getSourceUrl(file)))).then((files: any) => {
            this.sources = files;
        });
    }

    refreshSource() {
        this.loadingSource = true;
        this.source = this.$sce.trustAsHtml('Loading...');

        const sourceUrl = this.getSourceUrl(this.selectedFile);

        this.$http.get(sourceUrl).then((response: angular.IHttpResponse<{}>) => {
            this.loadingSource = false;
            const extension = this.selectedFile.match(/\.([a-z]+)$/)[1];
            const highlightedSource = highlight((response.data as string).trim(), extension);
            this.source = this.$sce.trustAsHtml(highlightedSource);
        });
    }

    getSourceUrl(file: string) {
        if (this.boilerplateFiles.indexOf(file) > -1) {
            return [this.boilerplatePath, file].join('/');
        }
        if (file == this.files[0]) {
            return this.resultUrl + '&preview=true';
        } else {
            if (this.config.type === 'multi') {
                return [this.config.options.sourcePrefix, this.section, this.name, this.currentType, file].join('/');
            } else {
                return [this.config.options.sourcePrefix, this.section, this.name, file].join('/');
            }
        }
    }

    openPlunker(clickEvent) {
        var postData: any = {
            'tags[0]': 'ag-grid',
            'tags[1]': 'example',
            private: true,
            description: this.title
        };

        this.sources.forEach((file: any, index: number) => {
            postData['files[' + this.allFiles[index] + ']'] = file.data;
        });

        this.formPostData('//plnkr.co/edit/?p=preview', true, postData);
    }

    titles: {[key: string]: string} = {
        vanilla: 'JavaScript',
        react: 'React',
        angular: 'Angular'
    };

    typeTitle(title: string) {
        return this.titles[title];
    }
}

ExampleRunner.$inject = ['$http', '$timeout', '$sce', '$q', 'formPostData', '$element', '$cookies'];

docs.component('exampleTab', {
    template: `
    <li role="presentation" ng-class="{ active: $ctrl.currentValue == $ctrl.value }">
            <a role="tab" ng-click="$ctrl.onClick(); $event.preventDefault()" href="#" title="{{$ctrl.tooltip}}">
            <i ng-class="['fa', $ctrl.icon]" aria-hidden="true"></i> {{$ctrl.title}}
        </a>
    </li>

    `,
    bindings: {
        icon: '<',
        title: '<',
        tooltip: '<',
        value: '<',
        currentValue: '<',
        onClick: '&'
    }
});

docs.component('exampleRunner', {
    template: ` 
        <div ng-class='["example-runner"]'>

        <div class="framework-chooser" ng-if="$ctrl.config.type === 'multi'">
            <span> Example version: </span>
            <div ng-class="{ 'btn-group': true, 'open': $ctrl.openFwDropdown }">

    <button type="button" 
    ng-click="$ctrl.toggleFwDropdown()" 
    ng-blur="$ctrl.hideFwDropdown()"
    class="btn btn-default dropdown-toggle" 
    data-toggle="dropdown" 
    aria-haspopup="true" 
    aria-expanded="false"> 

    <span ng-class="[ 'runner-item-' + $ctrl.currentType, 'runner-item' ]">{{$ctrl.typeTitle($ctrl.currentType)}} </span>
    <span class="caret"></span> 

    </button>

                <ul class="dropdown-menu">
    <li ng-repeat="type in $ctrl.availableTypes">
        <a href="#" ng-click="$ctrl.setAndPersistType(type); $event.preventDefault();" ng-class="['runner-item', 'runner-item-' + type ]">{{$ctrl.typeTitle(type)}}</a>
    </li>
                </ul>
            </div>
        </div>


    <div class="example-wrapper">
        <ul role="tablist" class="primary">
            <li class="title">
                <a href="#example-{{$ctrl.name}}" title="link to {{$ctrl.title}}" id="example-{{$ctrl.name}}"> <i class="fa fa-link" aria-hidden="true"></i> {{$ctrl.title}} </a>
            </li>

            <example-tab 
                value="'result'" 
                current-value="$ctrl.selectedTab" 
                title="'Result'"
                tooltip="'Live Result of the Example'"
                icon="'fa-play'" 
                on-click="$ctrl.selectedTab = 'result'">
            </example-tab>

            <example-tab 
                value="'code'" 
                current-value="$ctrl.selectedTab" 
                title="'Code'"
                tooltip="'Examine Example Source Code'"
                icon="'fa-code'" 
                on-click="$ctrl.selectedTab = 'code'">
            </example-tab>


            <li role="presentation">
                <a role="tab" ng-href="{{$ctrl.resultUrl}}" target="_blank" title="Open Example in New Tab">
                    <i class="fa fa-arrows-alt" aria-hidden="true"></i> New Tab
                </a>
            </li>

            <example-tab 
                value="'plunker'" 
                current-value="$ctrl.selectedTab" 
                title="'Plunker'"
                tooltip="'Open Example in Plunker'"
                icon="'fa-external-link'" 
                on-click="$ctrl.openPlunker($event); $event.preventDefault()">
            </example-tab>

        </ul>  

        <div class="loading-placeholder" ng-if="!$ctrl.ready" ng-style="$ctrl.iframeStyle">
            <i class="fa fa-spinner fa-pulse fa-3x fa-fw"></i>
        </div>

        <div class="tab-contents" ng-if="$ctrl.ready">
            <div ng-show="$ctrl.selectedTab == 'result'" role="tabpanel" class="result">
                <iframe ng-src="{{$ctrl.resultUrl}}" ng-style="$ctrl.iframeStyle" seamless="true"></iframe>
            </div>

            <div ng-if="$ctrl.selectedTab == 'code'" role="tabpanel" class="code-browser">
                <ul role="tablist" class="secondary">

                    <li ng-if="$ctrl.boilerplateFiles.length > 0" class="separator">
                         App
                    </li>

                    <example-tab 
                        ng-repeat="file in $ctrl.files"
                        value="file" 
                        current-value="$ctrl.selectedFile" 
                        title="file"
                        icon="'fa-file-code-o'" 
                        on-click="$ctrl.selectedFile = file; $ctrl.refreshSource()">
                    </example-tab>

                    <li ng-if="$ctrl.boilerplateFiles.length > 0" class="separator">
                        Framework
                    </li>

                    <example-tab
                        ng-repeat="file in $ctrl.boilerplateFiles"
                        value="file"
                        current-value="$ctrl.selectedFile"
                        title="file"
                        icon="'fa-file-code-o'"
                        on-click="$ctrl.selectedFile = file; $ctrl.refreshSource()">
                    </example-tab>
                </ul>

                <pre><code ng-bind-html="$ctrl.source"></code></pre>
            </div>
        </div>

        </div>
    </div>
    `,
    bindings: {
        config: '<'
    },

    controller: ExampleRunner
});

docs.component('preview', {
    bindings: {
        resultUrl: '<',
        sourceCodeUrl: '<',
        title: '<',
        name: '<',
        options: '<'
    },

    template: ` 
        <div ng-class='["example-runner"]'>
        <ul role="tablist" class="primary">
            <li class="title">
                <a href="#example-{{$ctrl.name}}" id="example-{{$ctrl.name}}"> <i class="fa fa-link" aria-hidden="true"></i> {{$ctrl.title}} </a>
            </li>

            <example-tab 
                value="'result'" 
                current-value="'result'" 
                title="'Result'"
                icon="'fa-play'" 
                >
            </example-tab>

            <li role="presentation">
                <a role="tab" ng-href="{{$ctrl.sourceCodeUrl}}" target="_blank">
                    <i class="fa fa-external-link" aria-hidden="true"></i> Browse Source Code
                </a>
            </li>

        </ul>  

        <div class="loading-placeholder" ng-if="!$ctrl.ready" ng-style="$ctrl.iframeStyle">
            <i class="fa fa-spinner fa-pulse fa-3x fa-fw"></i>
        </div>
        <div class="loading-placeholder" ng-if="!$ctrl.ready">
            <i class="fa fa-spinner fa-pulse fa-3x fa-fw"></i>
        </div>

        <div class="tab-contents" ng-if="$ctrl.ready">
            <div role="tabpanel" class="result">
                <a ng-href={{$ctrl.resultUrl}} target="_blank" class="result-in-new-tab" title="Show Result in New Tab"><i class="fa fa-arrows-alt" aria-hidden="true"></i></a>
                <iframe src="{{$ctrl.resultUrl}}" ng-style="$ctrl.iframeStyle" seamless="true"></iframe>
            </div>
        </div>

    </div>
    `,

    controller: [
        '$timeout',
        '$element',
        function($timeout, $element) {
            this.ready = false;

            this.$onInit = function() {
                this.iframeStyle = {};

                if (this.options.exampleHeight) {
                    this.iframeStyle.height = this.options.exampleHeight + 'px';
                }

                whenInViewPort($element, () => {
                    $timeout(() => (this.ready = true));
                });
            };
        }
    ]
});
