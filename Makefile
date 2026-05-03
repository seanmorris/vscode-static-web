-include .env

ROOT_DIR:=$(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
EXTENSIONS_SKIP_FILE?=$(ROOT_DIR)/extensions-skip.list

VSCODE_TAG?=1.89.0
ifneq ($(filter command line environment override,$(origin VSCODE_SKIP_EXTENSIONS)),)
else
VSCODE_SKIP_EXTENSIONS:=$(shell "$(ROOT_DIR)/scripts/read-extension-list.sh" "$(EXTENSIONS_SKIP_FILE)")
endif
VSCODE_BASEPATH?=

VSCODE_RESOURCE_URL_TEMPLATE?=
VSCODE_SERVICE_URL?=
VSCODE_ITEM_URL?=

.PHONY: all serve clean clean-static extensions test test-smoke test-e2e deploy

all: public/index.html

SHELL=/bin/bash -euxo pipefail

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
		find out node_modules resources extensions -type l ! -exec test -e {} \; -delete;\
		cp -Pprf out ../../public/out;\
		cp -Pprf node_modules resources extensions ../../public;\
	}
	./sync-extra-extensions.sh ./extra_extensions ./public/extensions
	find public -type l ! -exec test -e {} \; -delete
	touch journal/.static-build

## Build the index.html file: ##
public/index.html: journal/.static-build source/index-template.html.php extensions
	@ echo "\033[33;4mGenerating index.html file...\033[0m"
	VSCODE_BASEPATH="${VSCODE_BASEPATH}" \
	VSCODE_SKIP_EXTENSIONS="${VSCODE_SKIP_EXTENSIONS}" \
	VSCODE_RESOURCE_URL_TEMPLATE="${VSCODE_RESOURCE_URL_TEMPLATE}" \
	VSCODE_SERVICE_URL="${VSCODE_SERVICE_URL}" \
	VSCODE_ITEM_URL="${VSCODE_ITEM_URL}" \
	php source/index-template.html.php > public/index.html;
	
## Clean the repo: ##
clean:
	rm -rf public/* third_party/* journal/*

## Clean the static assets : ##
clean-static:
	rm -rf public/* journal/.static-build

## Run the testing server: ##
serve: all
	cd public/ && npx http-server

## Run the project test suite ##
test:
	bash ./tests/run.sh

## Run the browser E2E suite ##
test-smoke:
	bash ./tests/e2e/run.sh

## Run the real built-site workbench E2E suite ##
test-e2e:
	bash ./tests/real-e2e/run.sh
		
## Copy extra extensions to public/extensions/ ##
extensions: journal/.static-build
	./sync-extra-extensions.sh ./extra_extensions ./public/extensions
	extensions_to_skip=$$(printf '%s' '${VSCODE_SKIP_EXTENSIONS}' | tr ',' ' ' | tr -d '"'); \
	for extension in $${extensions_to_skip}; do rm -rf "./public/extensions/$${extension}"; done
	find public -type l ! -exec test -e {} \; -delete
	touch journal/.extensions

## Build and deploy to Cloudflare Pages + R2 ##
deploy: all
	./deploy.sh
