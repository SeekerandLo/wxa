import mapState from './mapState';
import reducerRegistry from './registry';
import {diff} from '@wxa/core';

import {
    createStore,
    combineReducers,
    applyMiddleware
} from 'redux'

const combine = (registryReducers, userReducers) => {
    // if the user directly pass combined reducers to plugin, then we need to use it directly;
    if (typeof userReducers === 'function') return userReducers;

    // const reducerNames = Object.keys(reducers);
    // Object.keys(initialState).forEach(item => {
    //     if (reducerNames.indexOf(item) === -1) {
    //         reducers[item] = (state = null) => state;
    //     }
    // });
    return combineReducers({...registryReducers, ...userReducers});
};

const checkAndFilterDataField = (data, maxSize = 1024 * 1000)=>{
    const check = (key, value) => {
        let str = JSON.stringify(value);
        if (typeof str !== 'string') return true;

        let len = str.length;
        if (len > maxSize) {
            console.error(`${key} 数据长度为${len}, 数据大于${maxSize}将无法同步到webview`);

            return false;
        } 
        return true;
    }

    let ret = Array.isArray(data)? [] : {};
    if (typeof data === 'object' && data != null) {
        Object.keys(data).forEach((key)=>{
            if(check(key, data[key])) {
                ret[key] = data[key];
            };
        });
    } else {
        ret = data;
    }
    return ret;
}

let mountRedux = function (originHook) {
    return function (...args) {
        this.$$reduxDiff = diff.bind(this);
        if(this.$store) {
            let connectState = ()=>{
                let newState = this.$store.getState();
                let lastState = this.$$storeLastState;
                let data = mapState(this.mapState, newState, lastState, this);
                if (data !== null) {
                    // 有效state
                    this.$$storeLastState = data;
                    let diffData = this.$$reduxDiff(data);
                    let validData = checkAndFilterDataField(diffData)
                    if(validData != null) this.setData(validData);
                }
            }
            this.$unsubscribe = this.$store.subscribe((...args) => {
                // Object updated && page is showing
                if(this.$$isCurrentPage) {
                    connectState();
                }
            });
            connectState();
        }
        if (originHook) originHook.apply(this, args);
    }
}

let unmountRedux = function (originUnmount) {
    return function (...args) {
        if (this.$unsubscribe) {
            this.$unsubscribe();
            this.$unsubscribe = null;
        }
        if (originUnmount) originUnmount.apply(this, args);
    }
}

export const wxaRedux = (options = {}) => {
    // get options.
    let args = [];
    let userReducers;
    let debug = false;
    if (Array.isArray(options)) {
        userReducers = options[0];
        // object reducer
        args = [combine(reducerRegistry.getReducers(), userReducers), ...options.slice(1)];
    } else {
        userReducers = options.reducers; 
        debug = options.debug;
        let {
            middlewares,
            initialState
        } = options;

        args = [combine(reducerRegistry.getReducers(), userReducers), initialState];
        if (Array.isArray(middlewares)) args.push(applyMiddleware(...middlewares));
        else if (typeof middlewares === 'function') args.push(middlewares);
    }

    // create Store directly;
    // cause the reducer may be attached at subpackages.
    let store = createStore.apply(null, args);
    reducerRegistry.setChangeListener((reducer)=>{
        let reducers = combine(reducer, userReducers);
        if(debug) {
            console.group('%c[@wxa/redux] Replacing reducers', 'font-size: 12px; color: green;');
            console.table({
                'registered reducer': reducer,
                'init reducer': userReducers
            });
            console.groupEnd();
        }
        store.replaceReducer(reducers);
    });

    let syncStore = function(){
        this.$$isCurrentPage = true;
        let data = mapState(this.mapState, this.$store.getState(), this.$$storeLastState, this);
        if (data != null) {
            let diffData = this.$$reduxDiff(data);
            let validData = checkAndFilterDataField(diffData);
            this.setData(validData);
        };
    }

    return (vm, type) => {
        switch (type) {
            case 'App':
                vm.$store = store;
                break;
            case 'Page':
                vm.$store = store;
                let { onLoad, onShow, onUnload, onHide } = vm;
                vm.onLoad = mountRedux(onLoad);
                vm.onShow = function (...args) {
                    syncStore.bind(this)();
                    if (onShow) onShow.apply(this, args);
                }
                vm.onHide = function (...args) {
                    this.$$isCurrentPage = false;
                    if (onHide) onHide.apply(this, args);
                }
                vm.onUnload = unmountRedux(onUnload);
                break;
            case 'Component':
                let {
                    created,
                    attached,
                    detached,
                    pageLifetimes
                } = vm;
                vm.pageLifetimes = pageLifetimes || {};
                let {show, hide} = vm.pageLifetimes;
                // auto sync store data to component.
                vm.pageLifetimes.show = function(args) {
                    syncStore.bind(this)();
                    if (show) show.apply(this, args);
                }
                vm.pageLifetimes.hide = function(args) {
                    this.$$isCurrentPage = false;
                    if (hide) hide.apply(this, args);
                }

                vm.created = function (...args) {
                    this.$store = store;
                    if (created) created.apply(this, args);
                }
                vm.attached = mountRedux(attached);
                vm.detached = unmountRedux(detached);
                break;
            default: 
                throw new Error('不合法的wxa组件类型');
        }
    };
}

export * from 'redux';

export {reducerRegistry};