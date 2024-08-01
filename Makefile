VSCODE_TAG=1.89.0
VSCODE_SKIP_EXTENSIONS=

.PHONY: all serve clean extensions

all: public/index.html

## Download the code ##
third_party/vscode/.gitignore:
	@ echo "\033[33;4mDownloading VS Code...\033[0m";
	git clone https://github.com/microsoft/vscode.git third_party/vscode\
		--branch ${VSCODE_TAG}\
		--single-branch\
		--depth 1;

## Pull the dependencies ##
journal/.pull-dependencies: third_party/vscode/.gitignore
	cd third_party/vscode && {\
		echo "\033[33;4mPulling dependencies...\033[0m";\
		git apply --no-index ../../patch/vscode.patch;\
		yarn;\
	}
	touch journal/.pull-dependencies;

## Compile the program ##
journal/.compiled: journal/.pull-dependencies
	cd third_party/vscode && {\
		echo "\033[33;4mBuilding VS Code...\033[0m";\
		yarn compile;\
		yarn compile-web;\
		yarn compile-build;\
		yarn minify-vscode & yarn minify-vscode-reh & yarn minify-vscode-reh-web;\
	}
	touch journal/.compiled

## Copy the static assets to public/ ##
journal/.static-build: journal/.compiled
	@ echo "\033[33;4mBuilding Static Distribution...\033[0m"
	cd public && rm -rf out node_modules resources extensions;
	cd third_party/vscode && {\
		cp -rfv node_modules resources extensions ../../public;\
		cp -rfv out ../../public/out;\
	}
	touch journal/.static-build

## Build the index.html file: ##
public/index.html: journal/.static-build source/index-template.html.php extensions
	@ echo "\033[33;4mGenerating index.html file...\033[0m"
	VSCODE_SKIP_EXTENSIONS=${VSCODE_SKIP_EXTENSIONS} php source/index-template.html.php > public/index.html;

## Clean the repo: ##
clean:
	rm -rf public/* third_party/* journal/*

## Clean the static assets : ##
clean-static:
	rm -rf public/* journal/.static-build

## Run the testing server: ##
serve: all
	cd public/ && npx http-server
	
## Copy extra extensions to public/extensions/ ##
extensions: journal/.static-build
	- cp -rf extra_extensions/* public/extensions/
	touch journal/.extensions
