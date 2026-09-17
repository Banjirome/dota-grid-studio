export namespace main {
	
	export class FilePayload {
	    path: string;
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new FilePayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.content = source["content"];
	    }
	}
	export class LaunchOptions {
	    openPath: string;
	    settingsPath: string;
	
	    static createFrom(source: any = {}) {
	        return new LaunchOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.openPath = source["openPath"];
	        this.settingsPath = source["settingsPath"];
	    }
	}
	export class ReferenceImagePayload {
	    name: string;
	    dataURL: string;
	
	    static createFrom(source: any = {}) {
	        return new ReferenceImagePayload(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.dataURL = source["dataURL"];
	    }
	}

}

