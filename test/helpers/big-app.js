// A synthetic freestyle app with many views, for performance checks. Every view looks like a typical
// screen: a header button, a search field, a filter bar, a table with a row template, a form, a footer.

const FORM_FIELDS = 8

function view(app, n, views) {
  const next = (n % views) + 1
  const fields = Array.from(
    { length: FORM_FIELDS },
    (_, f) => `				<Label text="{i18n>field${n}_${f}}" labelFor="input${f}" />
				<Input id="input${f}" value="{field${f}}" />`,
  ).join('\n')
  return `<mvc:View controllerName="${app}.controller.View${n}"
	xmlns="sap.m" xmlns:mvc="sap.ui.core.mvc" xmlns:core="sap.ui.core" xmlns:f="sap.ui.layout.form">
	<Page id="page" title="{i18n>title${n}}" showNavButton="true" navButtonPress=".onNavBack">
		<headerContent>
			<Button id="helpBtn" icon="sap-icon://hint" tooltip="{i18n>help}" press=".onHelp" />
			<Button id="nextBtn" text="{i18n>next}" press=".onNext" />
		</headerContent>
		<subHeader>
			<Toolbar id="toolbar">
				<SearchField id="search" placeholder="{i18n>search}" search=".onSearch" />
				<Select id="statusFilter" change=".onFilter">
					<core:Item key="all" text="All" />
					<core:Item key="open" text="Open" />
					<core:Item key="done" text="Done" />
				</Select>
				<ToolbarSpacer />
				<Button id="createBtn" type="Emphasized" text="{i18n>create}" press=".onCreate" />
			</Toolbar>
		</subHeader>
		<content>
			<Table id="table" items="{/Items${n}}">
				<columns>
					<Column><Text text="{i18n>colId}" /></Column>
					<Column><Text text="{i18n>colName}" /></Column>
					<Column><Text text="{i18n>colStatus}" /></Column>
				</columns>
				<items>
					<ColumnListItem press=".onItemPress" type="Navigation">
						<cells>
							<ObjectIdentifier title="{id}" />
							<Text text="{name}" />
							<ObjectStatus text="{status}" />
						</cells>
					</ColumnListItem>
				</items>
			</Table>
			<f:SimpleForm id="form" editable="true" layout="ResponsiveGridLayout" title="{i18n>form}">
${fields}
			</f:SimpleForm>
		</content>
		<footer>
			<OverflowToolbar id="footer">
				<ToolbarSpacer />
				<Button id="saveBtn" type="Emphasized" text="{i18n>save}" press=".onSave" />
				<Button id="deleteBtn" type="Reject" text="{i18n>delete}" press=".onOpenDialog" />
				<Button id="goBtn" text="Go to ${next}" press=".onNext" />
			</OverflowToolbar>
		</footer>
	</Page>
</mvc:View>
`
}

function controller(app, n, views) {
  const next = (n % views) + 1
  return `sap.ui.define(["sap/ui/core/mvc/Controller", "sap/ui/core/Fragment", "sap/m/MessageToast"], function (Controller, Fragment, MessageToast) {
	"use strict";
	// controller ${n}
	return Controller.extend("${app}.controller.View${n}", {
		onInit: function () {},
		onNavBack: function () { window.history.go(-1); },
		onHelp: function () { MessageToast.show("Help"); },
		onNext: function () { this.getOwnerComponent().getRouter().navTo("view${next}"); },
		onSearch: function (oEvent) { this.byId("table").getBinding("items").filter([]); },
		onFilter: function () {},
		onCreate: function () { this.getOwnerComponent().getRouter().navTo("view${next}", { id: "new" }); },
		onItemPress: function () {},
		onSave: function () { MessageToast.show("Saved"); },
		onOpenDialog: function () {
			Fragment.load({ id: this.getView().getId(), name: "${app}.fragment.Confirm${n % 5}", controller: this }).then(function (d) { d.open(); });
		}
	});
});
`
}

const fragment = (n) => `<core:FragmentDefinition xmlns="sap.m" xmlns:core="sap.ui.core">
	<Dialog id="confirmDialog" title="Confirm ${n}">
		<content><Text id="confirmText" text="Are you sure?" /></content>
		<beginButton><Button id="confirmBtn" text="Yes" press=".onSave" /></beginButton>
		<endButton><Button id="cancelBtn" text="No" press=".onNavBack" /></endButton>
	</Dialog>
</core:FragmentDefinition>
`

/** @returns {Array<{path: string, content: string}>} the files of an app with `views` views */
export function bigApp({ views = 40, app = 'big.app' } = {}) {
  const files = []
  const routes = []
  const targets = {}
  for (let n = 1; n <= views; n++) {
    files.push({ path: `webapp/view/View${n}.view.xml`, content: view(app, n, views) })
    files.push({
      path: `webapp/controller/View${n}.controller.js`,
      content: controller(app, n, views),
    })
    routes.push({ name: `view${n}`, pattern: n === 1 ? '' : `view${n}/{id}`, target: `view${n}` })
    targets[`view${n}`] = { viewName: `View${n}`, viewId: `view${n}`, viewLevel: n }
  }
  for (let n = 0; n < 5; n++)
    files.push({ path: `webapp/fragment/Confirm${n}.fragment.xml`, content: fragment(n) })
  const i18n = [
    'help=Help',
    'next=Next',
    'search=Search',
    'create=Create',
    'save=Save',
    'delete=Delete',
    'form=Details',
    'colId=ID',
    'colName=Name',
    'colStatus=Status',
  ]
  for (let n = 1; n <= views; n++) {
    i18n.push(`title${n}=Screen ${n}`)
    for (let f = 0; f < FORM_FIELDS; f++) i18n.push(`field${n}_${f}=Field ${f} of screen ${n}`)
  }
  files.push({ path: 'webapp/i18n/i18n.properties', content: i18n.join('\n') + '\n' })
  files.push({
    path: 'webapp/manifest.json',
    content: JSON.stringify({
      'sap.app': { id: app, type: 'application', i18n: 'i18n/i18n.properties' },
      'sap.ui5': {
        rootView: { viewName: `${app}.view.View1`, type: 'XML', id: 'root' },
        dependencies: { minUI5Version: '1.108.0', libs: { 'sap.m': {}, 'sap.ui.layout': {} } },
        models: {
          i18n: {
            type: 'sap.ui.model.resource.ResourceModel',
            settings: { bundleName: `${app}.i18n.i18n` },
          },
        },
        routing: {
          config: {
            routerClass: 'sap.m.routing.Router',
            viewType: 'XML',
            viewPath: `${app}.view`,
            controlId: 'app',
          },
          routes,
          targets,
        },
      },
    }),
  })
  return files
}
