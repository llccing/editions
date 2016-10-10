/* @flow */
/* eslint no-console:0 */
// Editions Loader

// Helper class to display nested error in a sensible way
class NestedError extends Error {
	constructor (message /* :string */, parent /* :Error */) {
		message += ' due to next parent error'
		super(message)
		this.stack += '\n\nParent ' + (parent.stack || parent.message || parent).toString()
	}
}

// Cache of which syntax combinations are supported or unsupported, hash of booleans
const EARLIST_NODE_VERSION_THAT_SUPPORTS_ESNEXT = 0.12
const syntaxFailedCombitions = {}  // sorted lowercase syntax combination => Error instance of failure
const syntaxSupport = {
	esnext: (process && process.versions && process.versions.node && Number(process.versions.node.split('.').slice(0, 2).join('.')) < EARLIST_NODE_VERSION_THAT_SUPPORTS_ESNEXT) ? false : null,
	import: false,
	coffeescript: false,
	typescript: false
}

/**
 * Cycle through the editions for a package and require the correct one
 * @param {string} cwd - the path of the package, used to load package.json:editions and handle relative edition entry points
 * @param {function} _require - the require method of the calling module, used to ensure require paths remain correct
 * @param {string} [customEntry] - an optional override for the entry of an edition, requires the edition to specify a `directory` property
 * @returns {void}
 */
module.exports.requirePackage = function requirePackage (cwd /* :string */, _require /* :function */, customEntry /* :: ?:string */ ) /* : void */ {
	// Fetch the result of the debug value
	// It is here to allow the environment to change it at runtime as needed
	const debug = process && process.env && process.env.DEBUG_BEVRY_EDITIONS
	// const blacklist = process && process.env && process.env.DEBUG_BEVRY_IGNORE_BLACKLIST

	// Load the package.json file to fetch `name` for debugging and `editions` for loading
	const pathUtil = require('path')
	const packagePath = pathUtil.join(cwd, 'package.json')
	const {name, editions} = require(packagePath)
	// name:string, editions:array

	if ( !editions || editions.length === 0 ) {
		throw new Error(`No editions have been specified for the package [${name}]`)
	}

	// Note the last error message
	let lastEditionFailure

	// Cycle through the editions
	for ( let i = 0; i < editions.length; ++i ) {
		// Extract relevant parts out of the edition
		// and generate a lower case, sorted, and joined combination of our syntax for caching
		const {syntaxes, entry, directory} = editions[i]
		// syntaxes:?array, entry:?string, directory:?string

		// Checks with hard failures to alert the developer
		if ( customEntry && !directory ) {
			throw new Error(`The package [${name}] has no directory property on its editions which is required when using custom entry point: ${customEntry}`)
		}
		else if ( !entry ) {
			throw new Error(`The package [${name}] has no entry property on its editions which is required when using default entry`)
		}

		// Get the correct entry path
		const entryPath = customEntry ? pathUtil.resolve(cwd, directory, customEntry) : pathUtil.resolve(cwd, entry)

		// Check syntax support
		// Convert syntaxes into a sorted lowercase string
		const syntaxCombination = syntaxes && syntaxes.map((i) => i.toLowerCase()).sort().join(', ')
		if ( syntaxCombination ) {
			// Check if any of the syntaxes are unsupported
			const unsupportedSyntaxes = syntaxes.filter((i) => syntaxSupport[i.toLowerCase()] === false)
			if ( unsupportedSyntaxes.length ) {
				lastEditionFailure = new Error(`Skipped package [${name}] edition at [${entryPath}] with unsupported syntaxes [${unsupportedSyntaxes}]`)
				if ( debug )  console.error(`DEBUG: ${lastEditionFailure.stack}`)
				continue
			}
			// Is this syntax combination unsupported? If so skip it with a soft failure to try the next edition
			else if ( syntaxFailedCombitions[syntaxCombination] ) {
				const syntaxFailure = syntaxFailedCombitions[syntaxCombination]
				lastEditionFailure = new NestedError(`Skipped package [${name}] edition at [${entryPath}] with blacklisted syntax combination [${syntaxCombination}]`, syntaxFailure)
				if ( debug )  console.error(`DEBUG: ${lastEditionFailure.stack}`)
				continue
			}
		}

		// Try and load this syntax combination
		try {
			return _require(entryPath)
		}
		catch ( error ) {
			// Note the error with more details
			lastEditionFailure = new NestedError(`Unable to load package [${name}] edition at [${entryPath}] with syntax [${syntaxCombination || 'no syntaxes specified'}]`, error)
			if ( debug )  console.error(`DEBUG: ${lastEditionFailure.stack}`)

			// Blacklist the combination, even if it may have worked before
			// Perhaps in the future note if that if it did work previously, then we should instruct module owners to be more specific with their syntaxes
			if ( syntaxCombination )  syntaxFailedCombitions[syntaxCombination] = lastEditionFailure
		}
	}

	// No edition was returned, so there is no suitable edition
	if ( !lastEditionFailure )  lastEditionFailure = new Error(`The package [${name}] failed without any actual errors...`)
	throw new NestedError(`The package [${name}] has no suitable edition for this environment`, lastEditionFailure)
}
